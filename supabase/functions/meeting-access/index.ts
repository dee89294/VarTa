/**
 * Edge Function: meeting-access
 * Purpose: Server-side meeting authorization, waiting room gate, entry-verified attendance tracking,
 *   duration heartbeat/leave ledger, calendar conflict checks, and meeting start/end lifecycle.
 * Why required:
 *   - Enforces participant invite checks on the server even if an uninvited employee knows the meeting URL.
 *   - Guarantees employees are marked `'present'` ONLY on `confirm_entry` (never just by clicking Join).
 *   - Atomically marks unjoined invitees `'absent'` and finalizes durations when `end_meeting` runs.
 * Called by:
 *   - `src/pages/ScheduleMeetingPage.tsx` (`check_conflicts`)
 *   - `src/pages/MyMeetingsPage.tsx` (`start_meeting`)
 *   - `src/pages/LiveMeetingPage.tsx` (`join`, `confirm_entry`, `heartbeat`, `leave`, `admit`, `reject`, `remove`, `invite_participants`, `end_meeting`)
 * Tables accessed: `meetings`, `meeting_participants`, `attendance`, `notifications`, `meeting_activity_logs`, `meeting_messages`, `employees`, `user_roles`
 * Authentication & Authorization:
 *   - Validates caller JWT (`auth.getUser(token)`) and requires `employees.status === 'active'`.
 *   - Checks organizer ownership / `meeting_participants` membership / `super_admin` privileges per action.
 * Impact if modified/removed: Meeting security gates, waiting room admission, live attendance, and reports fail.
 */
import { corsHeaders, getSupabaseAdmin, jsonResponse } from './shared.ts'
import {
  handleCancelMeeting,
  handleDispatchScheduleInvites,
  handleEndMeeting,
  handleInviteParticipants,
  handleTestSmtp,
} from './meetingLifecycle.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) {
      return jsonResponse({ error: 'Authentication required to enter meetings.' }, 401)
    }

    const supabaseAdmin = getSupabaseAdmin()

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return jsonResponse({ error: 'Your login session is invalid or expired.' }, 401)
    }

    const { data: callerEmp } = await supabaseAdmin
      .from('employees')
      .select('id, employee_code, full_name, status, email')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!callerEmp || callerEmp.status !== 'active') {
      return jsonResponse({ error: 'Only active registered employees can access meetings.' }, 403)
    }

    const { data: callerRoleRow } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
    const callerRole = callerRoleRow?.role ?? 'employee'

    const body = await req.json()
    const action = body?.action as string

    if (action === 'check_conflicts') {
      if (callerRole !== 'super_admin' && callerRole !== 'organizer') {
        return jsonResponse({ error: 'Only organizers or admins can check scheduling conflicts.' }, 403)
      }
      const startIso = String(body?.scheduled_start ?? '')
      const endIso = String(body?.scheduled_end ?? '')
      const participantIds = Array.isArray(body?.participant_ids) ? (body.participant_ids as string[]) : []
      const excludeId = body?.exclude_meeting_id ? String(body.exclude_meeting_id) : null
      const organizerId = body?.organizer_id ? String(body.organizer_id) : callerEmp.id

      if (!startIso || !endIso) {
        return jsonResponse({ error: 'scheduled_start and scheduled_end are required.' }, 400)
      }

      const { data: candidates } = await supabaseAdmin
        .from('meetings')
        .select('id, title, meeting_code, organizer_id, scheduled_start, scheduled_end, meeting_participants(employee_id)')
        .in('status', ['scheduled', 'live'])
        .lt('scheduled_start', endIso)
        .gt('scheduled_end', startIso)

      const targetSet = new Set([organizerId, ...participantIds])
      const conflicts = (candidates ?? [])
        .filter((m) => !excludeId || m.id !== excludeId)
        .map((m) => {
          const mPartIds = (m.meeting_participants as { employee_id: string }[] | null)?.map((p) => p.employee_id) ?? []
          const affected = new Set<string>()
          if (targetSet.has(m.organizer_id)) affected.add(m.organizer_id)
          for (const pid of mPartIds) {
            if (targetSet.has(pid)) affected.add(pid)
          }
          if (affected.size === 0) return null
          return {
            meeting_id: m.id,
            meeting_code: m.meeting_code,
            conflict_type: m.organizer_id === organizerId || affected.has(organizerId) ? 'organizer_conflict' : 'participant_conflict',
            scheduled_start: m.scheduled_start,
            scheduled_end: m.scheduled_end,
            affected_count: affected.size,
            affected_employee_ids: Array.from(affected),
            meeting_title: callerRole === 'super_admin' || m.organizer_id === callerEmp.id ? m.title : 'Scheduled Meeting Conflict',
          }
        })
        .filter(Boolean)

      return jsonResponse({ conflicts })
    }

    if (action === 'test_smtp') {
      return await handleTestSmtp(supabaseAdmin, callerEmp, callerRole, user, body)
    }

    const meeting_id = String(body?.meeting_id ?? '')

    if (!meeting_id) {
      return jsonResponse({ error: 'meeting_id is required.' }, 400)
    }

    const { data: meeting, error: meetingErr } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('id', meeting_id)
      .maybeSingle()

    if (meetingErr || !meeting) {
      return jsonResponse({ error: 'Meeting not found.' }, 404)
    }

    const isOrganizer = meeting.organizer_id === callerEmp.id
    const isAdmin = callerRole === 'super_admin'

    if (action === 'join') {
      if (meeting.status === 'cancelled') {
        return jsonResponse({ error: 'This meeting has been cancelled.' }, 403)
      }
      if (meeting.status === 'completed') {
        return jsonResponse({ error: 'This meeting has already ended.' }, 403)
      }

      const { data: participant } = await supabaseAdmin
        .from('meeting_participants')
        .select('*')
        .eq('meeting_id', meeting_id)
        .eq('employee_id', callerEmp.id)
        .maybeSingle()

      if (!isOrganizer && (!participant || participant.admission_status === 'removed' || participant.admission_status === 'rejected')) {
        return jsonResponse(
          {
            error:
              'Access Denied: You are not invited to this meeting. Only employees selected by the organizer may enter.',
          },
          403
        )
      }

      if (isOrganizer) {
        await supabaseAdmin.from('meeting_participants').upsert(
          {
            meeting_id,
            employee_id: callerEmp.id,
            role_in_meeting: 'organizer',
            admission_status: 'admitted',
            invited_by: callerEmp.id,
          },
          { onConflict: 'meeting_id,employee_id' }
        )

        return jsonResponse({
          authorized: true,
          state: 'admitted',
          isOrganizer: true,
          meeting,
        })
      }

      // Non-organizer invited employee
      if (meeting.status === 'scheduled') {
        if (meeting.waiting_room_enabled) {
          const prevStatus = participant?.admission_status
          await supabaseAdmin
            .from('meeting_participants')
            .update({ admission_status: 'waiting' })
            .eq('id', participant.id)

          await supabaseAdmin.from('attendance').upsert(
            {
              meeting_id,
              employee_id: callerEmp.id,
              status: 'waiting',
              verified_entry: false,
            },
            { onConflict: 'meeting_id,employee_id' }
          )

          if (prevStatus !== 'waiting') {
            await supabaseAdmin.from('notifications').insert({
              recipient_employee_id: meeting.organizer_id,
              meeting_id,
              type: 'waiting_room',
              title: 'Employee in Waiting Room',
              message: `${callerEmp.full_name} (${callerEmp.employee_code}) is waiting to join "${meeting.title}".`,
            })
          }
        }
        return jsonResponse({
          authorized: true,
          state: 'waiting_room',
          reason: 'waiting_for_start',
          isOrganizer: false,
          meeting,
        })
      }

      // Meeting is live
      if (meeting.waiting_room_enabled && participant.admission_status !== 'admitted') {
        const prevStatus = participant.admission_status
        await supabaseAdmin
          .from('meeting_participants')
          .update({ admission_status: 'waiting' })
          .eq('id', participant.id)

        await supabaseAdmin.from('attendance').upsert(
          {
            meeting_id,
            employee_id: callerEmp.id,
            status: 'waiting',
            verified_entry: false,
          },
          { onConflict: 'meeting_id,employee_id' }
        )

        if (prevStatus !== 'waiting') {
          await supabaseAdmin.from('notifications').insert({
            recipient_employee_id: meeting.organizer_id,
            meeting_id,
            type: 'waiting_room',
            title: 'Participant Waiting for Admission',
            message: `${callerEmp.full_name} (${callerEmp.employee_code}) is waiting to join "${meeting.title}".`,
          })
        }

        return jsonResponse({
          authorized: true,
          state: 'waiting_room',
          reason: 'waiting_for_admission',
          isOrganizer: false,
          meeting,
        })
      }

      await supabaseAdmin
        .from('meeting_participants')
        .update({ admission_status: 'admitted' })
        .eq('id', participant.id)

      return jsonResponse({
        authorized: true,
        state: 'admitted',
        isOrganizer: false,
        meeting,
      })
    }

    if (action === 'start_meeting') {
      if (!isOrganizer && !isAdmin) {
        return jsonResponse({ error: 'Only the organizer or Super Admin can start this meeting.' }, 403)
      }
      if (meeting.status === 'cancelled' || meeting.status === 'completed') {
        return jsonResponse({ error: `Cannot start a ${meeting.status} meeting.` }, 400)
      }

      const nowIso = new Date().toISOString()
      const { data: updatedMeeting } = await supabaseAdmin
        .from('meetings')
        .update({
          status: 'live',
          actual_started_at: meeting.actual_started_at ?? nowIso,
        })
        .eq('id', meeting_id)
        .select('*')
        .single()

      // Ensure organizer participant row exists
      await supabaseAdmin.from('meeting_participants').upsert(
        {
          meeting_id,
          employee_id: meeting.organizer_id,
          role_in_meeting: 'organizer',
          admission_status: 'admitted',
          invited_by: meeting.organizer_id,
        },
        { onConflict: 'meeting_id,employee_id' }
      )

      // Seed absent rows for invited employees not already waiting/present
      const { data: invitees } = await supabaseAdmin
        .from('meeting_participants')
        .select('employee_id')
        .eq('meeting_id', meeting_id)
        .in('admission_status', ['invited', 'waiting', 'admitted'])

      if (invitees && invitees.length > 0) {
        const { data: existingAtt } = await supabaseAdmin
          .from('attendance')
          .select('employee_id')
          .eq('meeting_id', meeting_id)

        const existingSet = new Set((existingAtt ?? []).map((a) => a.employee_id))
        const toInsert = invitees
          .filter((i) => !existingSet.has(i.employee_id))
          .map((i) => ({
            meeting_id,
            employee_id: i.employee_id,
            status: 'absent',
            verified_entry: false,
          }))

        if (toInsert.length > 0) {
          await supabaseAdmin.from('attendance').insert(toInsert)
        }

        const notifyIds = invitees.map((i) => i.employee_id).filter((id) => id !== callerEmp.id)
        if (notifyIds.length > 0) {
          await supabaseAdmin.from('notifications').insert(
            notifyIds.map((id) => ({
              recipient_employee_id: id,
              meeting_id,
              type: 'meeting_started',
              title: 'Meeting Started',
              message: `"${meeting.title}" is now live. Join now to record your attendance.`,
            }))
          )
        }
      }

      await supabaseAdmin.from('meeting_activity_logs').insert({
        meeting_id,
        actor_employee_id: callerEmp.id,
        action: 'meeting_started',
        details: { title: meeting.title },
      })

      await supabaseAdmin.from('meeting_messages').insert({
        meeting_id,
        sender_employee_id: callerEmp.id,
        sender_name: callerEmp.full_name,
        sender_code: callerEmp.employee_code,
        content: `${callerEmp.full_name} started the meeting.`,
        message_type: 'system',
      })

      return jsonResponse({ ok: true, meeting: updatedMeeting })
    }

    if (action === 'confirm_entry') {
      if (meeting.status === 'cancelled' || meeting.status === 'completed') {
        return jsonResponse({ error: `Meeting is ${meeting.status}.` }, 403)
      }

      // If organizer enters a scheduled meeting directly, transition to live
      if (isOrganizer && meeting.status === 'scheduled') {
        const nowIso = new Date().toISOString()
        await supabaseAdmin
          .from('meetings')
          .update({ status: 'live', actual_started_at: meeting.actual_started_at ?? nowIso })
          .eq('id', meeting_id)

        const { data: invitees } = await supabaseAdmin
          .from('meeting_participants')
          .select('employee_id')
          .eq('meeting_id', meeting_id)
          .in('admission_status', ['invited', 'waiting', 'admitted'])

        if (invitees && invitees.length > 0) {
          const { data: existingAtt } = await supabaseAdmin
            .from('attendance')
            .select('employee_id')
            .eq('meeting_id', meeting_id)
          const existingSet = new Set((existingAtt ?? []).map((a) => a.employee_id))
          const missing = invitees
            .filter((i) => !existingSet.has(i.employee_id) && i.employee_id !== callerEmp.id)
            .map((i) => ({
              meeting_id,
              employee_id: i.employee_id,
              status: 'absent',
              verified_entry: false,
            }))
          if (missing.length > 0) {
            await supabaseAdmin.from('attendance').insert(missing)
          }

          const notifyIds = invitees.map((i) => i.employee_id).filter((id) => id !== callerEmp.id)
          if (notifyIds.length > 0) {
            await supabaseAdmin.from('notifications').insert(
              notifyIds.map((id) => ({
                recipient_employee_id: id,
                meeting_id,
                type: 'meeting_started',
                title: 'Meeting is Live',
                message: `"${meeting.title}" has started. Click to join now.`,
              }))
            )
          }
        }
      } else if (meeting.status !== 'live') {
        return jsonResponse({ error: 'Meeting has not started yet.' }, 403)
      }

      const { data: participant } = await supabaseAdmin
        .from('meeting_participants')
        .select('admission_status')
        .eq('meeting_id', meeting_id)
        .eq('employee_id', callerEmp.id)
        .maybeSingle()

      if (!isOrganizer && participant?.admission_status !== 'admitted') {
        return jsonResponse({ error: 'Entry not yet admitted by organizer.' }, 403)
      }

      const nowIso = new Date().toISOString()
      const { data: existingAtt } = await supabaseAdmin
        .from('attendance')
        .select('*')
        .eq('meeting_id', meeting_id)
        .eq('employee_id', callerEmp.id)
        .maybeSingle()

      const wasAlreadyVerified = Boolean(existingAtt?.verified_entry)

      const { data: attRow, error: attErr } = await supabaseAdmin
        .from('attendance')
        .upsert(
          {
            meeting_id,
            employee_id: callerEmp.id,
            status: 'present',
            verified_entry: true,
            join_time: existingAtt?.join_time ?? nowIso,
            leave_time: null,
            last_heartbeat_at: nowIso,
            total_duration_seconds: existingAtt?.total_duration_seconds ?? 0,
          },
          { onConflict: 'meeting_id,employee_id' }
        )
        .select('*')
        .single()

      if (attErr) return jsonResponse({ error: attErr.message }, 500)

      if (!wasAlreadyVerified || existingAtt?.leave_time) {
        await supabaseAdmin.from('meeting_activity_logs').insert({
          meeting_id,
          actor_employee_id: callerEmp.id,
          action: 'joined_meeting',
          details: { employee_code: callerEmp.employee_code, full_name: callerEmp.full_name },
        })

        if (!isOrganizer) {
          await supabaseAdmin.from('notifications').insert({
            recipient_employee_id: meeting.organizer_id,
            meeting_id,
            type: 'participant_joined',
            title: 'Employee Joined Meeting',
            message: `${callerEmp.full_name} (${callerEmp.employee_code}) entered "${meeting.title}".`,
          })
        }
      }

      return jsonResponse({ ok: true, attendance: attRow })
    }

    if (action === 'heartbeat') {
      if (meeting.status !== 'live') return jsonResponse({ ok: true })
      const { data: att } = await supabaseAdmin
        .from('attendance')
        .select('*')
        .eq('meeting_id', meeting_id)
        .eq('employee_id', callerEmp.id)
        .maybeSingle()

      if (att && att.verified_entry && att.status === 'present' && !att.leave_time) {
        const lastMs = att.last_heartbeat_at ? new Date(att.last_heartbeat_at).getTime() : Date.now()
        const deltaSec = Math.min(90, Math.max(0, Math.round((Date.now() - lastMs) / 1000)))
        await supabaseAdmin
          .from('attendance')
          .update({
            total_duration_seconds: (att.total_duration_seconds ?? 0) + deltaSec,
            last_heartbeat_at: new Date().toISOString(),
          })
          .eq('id', att.id)
      }
      return jsonResponse({ ok: true })
    }

    if (action === 'leave') {
      const { data: att } = await supabaseAdmin
        .from('attendance')
        .select('*')
        .eq('meeting_id', meeting_id)
        .eq('employee_id', callerEmp.id)
        .maybeSingle()

      const nowIso = new Date().toISOString()
      if (att && att.verified_entry && att.status === 'present' && !att.leave_time) {
        const lastMs = att.last_heartbeat_at ? new Date(att.last_heartbeat_at).getTime() : Date.now()
        const deltaSec = Math.min(120, Math.max(0, Math.round((Date.now() - lastMs) / 1000)))
        await supabaseAdmin
          .from('attendance')
          .update({
            total_duration_seconds: (att.total_duration_seconds ?? 0) + deltaSec,
            leave_time: nowIso,
            last_heartbeat_at: nowIso,
          })
          .eq('id', att.id)

        await supabaseAdmin.from('meeting_activity_logs').insert({
          meeting_id,
          actor_employee_id: callerEmp.id,
          action: 'left_meeting',
          details: { employee_code: callerEmp.employee_code, full_name: callerEmp.full_name },
        })

        if (!isOrganizer) {
          await supabaseAdmin.from('notifications').insert({
            recipient_employee_id: meeting.organizer_id,
            meeting_id,
            type: 'participant_left',
            title: 'Employee Left Meeting',
            message: `${callerEmp.full_name} (${callerEmp.employee_code}) left "${meeting.title}".`,
          })
        }
      }
      return jsonResponse({ ok: true })
    }

    if (action === 'admit' || action === 'reject' || action === 'remove') {
      if (!isOrganizer && !isAdmin) {
        return jsonResponse({ error: 'Only the organizer or Super Admin can manage participants.' }, 403)
      }
      const target_employee_id = String(body?.target_employee_id ?? '')
      if (!target_employee_id) return jsonResponse({ error: 'target_employee_id required' }, 400)

      const nextAdmission =
        action === 'admit' ? 'admitted' : action === 'reject' ? 'rejected' : 'removed'

      await supabaseAdmin
        .from('meeting_participants')
        .update({ admission_status: nextAdmission })
        .eq('meeting_id', meeting_id)
        .eq('employee_id', target_employee_id)

      if (action === 'admit') {
        await supabaseAdmin.from('notifications').insert({
          recipient_employee_id: target_employee_id,
          meeting_id,
          type: 'admitted',
          title: 'Admitted to Meeting',
          message: `You have been admitted into "${meeting.title}".`,
        })
      } else {
        await supabaseAdmin
          .from('attendance')
          .update({ status: 'absent', verified_entry: false })
          .eq('meeting_id', meeting_id)
          .eq('employee_id', target_employee_id)
          .eq('verified_entry', false)
      }

      return jsonResponse({ ok: true, admission_status: nextAdmission })
    }

    if (action === 'invite_participants') {
      return await handleInviteParticipants(supabaseAdmin, meeting, callerEmp, body, isOrganizer, isAdmin)
    }

    if (action === 'dispatch_schedule_invites') {
      return await handleDispatchScheduleInvites(supabaseAdmin, meeting, callerEmp, isOrganizer, isAdmin)
    }

    if (action === 'cancel_meeting') {
      return await handleCancelMeeting(supabaseAdmin, meeting, callerEmp, isOrganizer, isAdmin)
    }

    if (action === 'end_meeting') {
      return await handleEndMeeting(supabaseAdmin, meeting, callerEmp, isOrganizer, isAdmin)
    }

    return jsonResponse({ error: 'Unsupported action' }, 400)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error' }, 500)
  }
})
