/**
 * Edge Function: get-livekit-token
 * Purpose: Authorizes organizers, invited registered users, and unauthenticated guests
 *   joining a VarTa meeting, records participation in `public.meeting_participants`,
 *   mints a signed LiveKit Cloud JWT token with server-enforced permissions, handles
 *   waiting room / leave / organizer-only end meeting & recording controls, and persists
 *   interactive meeting dashboard state (`summary`, `meeting_tasks`, `meeting_messages`).
 *
 * Security:
 *   - Reads `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` exclusively from
 *     Supabase Edge Function Secrets (`Deno.env`).
 *   - Never grants `roomAdmin: true` to guests or non-organizer invitees.
 *   - Validates invitation tokens on the backend via SHA-256 hash matching.
 */
import {
  callLiveKitRoomService,
  corsHeaders,
  findMeetingByIdentifier,
  getSupabaseAdmin,
  jsonResponse,
  mintLiveKitToken,
  resolveOptionalCaller,
  verifyMeetingAccess,
} from './shared.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = String(body.action || 'join_token')
    const meetingIdentifier = String(body.meeting_id || body.meetingId || '')
    const inviteToken = String(body.invite_token || body.token || '')
    const shareToken = String(body.share_token || body.invite || '')

    if (!meetingIdentifier) {
      return jsonResponse({ error: 'meeting_id is required.' }, 400)
    }

    const supabaseAdmin = getSupabaseAdmin()
    const caller = await resolveOptionalCaller(req, supabaseAdmin)
    const meeting = await findMeetingByIdentifier(supabaseAdmin, meetingIdentifier)

    if (!meeting) {
      return jsonResponse({ error: 'Meeting not found.' }, 404)
    }

    const access = await verifyMeetingAccess(supabaseAdmin, meeting, caller, inviteToken, shareToken)

    // Safe pre-join preview (never exposes `share_token_hash` or private details to uninvited visitors)
    if (action === 'preview') {
      if (!access.authorized) {
        return jsonResponse({ error: access.reason }, 403)
      }

      let callerName = ''
      if (caller) {
        const { data: prof } = await supabaseAdmin
          .from('profiles')
          .select('full_name')
          .eq('id', caller.id)
          .maybeSingle()
        callerName = prof?.full_name || String(caller.user_metadata?.full_name || '')
      }

      return jsonResponse({
        authorized: true,
        is_organizer: access.isOrganizer,
        caller_name: callerName,
        caller_email: caller?.email ?? null,
        meeting: {
          id: meeting.id,
          meeting_code: meeting.meeting_code,
          meeting_title: meeting.meeting_title,
          meeting_status: meeting.meeting_status,
          waiting_room_enabled: meeting.waiting_room_enabled,
          description: meeting.description,
          agenda: meeting.agenda,
          discussion_points: meeting.discussion_points,
          recording_status: meeting.recording_status,
          recording_started_at: meeting.recording_started_at,
          scheduled_at: meeting.scheduled_at,
          organizer_name: meeting.organizer?.full_name ?? 'Meeting Host',
        },
      })
    }

    // Load dashboard workspace (Summary + Tasks List + Room Chat + Recording state)
    if (action === 'workspace_state') {
      if (!access.authorized) {
        return jsonResponse({ error: access.reason }, 403)
      }

      const [tasksRes, msgsRes] = await Promise.all([
        supabaseAdmin
          .from('meeting_tasks')
          .select('id, meeting_id, title, status, is_completed, assigned_to, due_date, created_by, created_at, updated_at')
          .eq('meeting_id', meeting.id)
          .order('created_at', { ascending: true }),
        supabaseAdmin
          .from('meeting_messages')
          .select('id, meeting_id, user_id, participant_identity, sender_name, sender_role, message_text, created_at')
          .eq('meeting_id', meeting.id)
          .order('created_at', { ascending: true })
          .limit(200),
      ])

      return jsonResponse({
        can_edit_workspace: Boolean(caller) && access.authorized,
        summary: {
          description: meeting.description ?? '',
          agenda: meeting.agenda ?? '',
          discussion_points: meeting.discussion_points ?? '',
        },
        recording_status: meeting.recording_status ?? 'idle',
        recording_started_at: meeting.recording_started_at ?? null,
        tasks: tasksRes.data ?? [],
        messages: msgsRes.data ?? [],
      })
    }

    // Update Meeting Summary (authorized registered/organizer users)
    if (action === 'update_summary') {
      if (!access.authorized || !caller) {
        return jsonResponse({ error: 'Only authorized signed-in participants can edit the meeting summary.' }, 403)
      }

      const description = String(body.description ?? '').trim()
      const agenda = String(body.agenda ?? '').trim()
      const discussionPoints = String(body.discussion_points ?? '').trim()

      const { error: updErr } = await supabaseAdmin
        .from('meetings')
        .update({
          description,
          agenda,
          discussion_points: discussionPoints,
        })
        .eq('id', meeting.id)

      if (updErr) return jsonResponse({ error: updErr.message }, 500)
      return jsonResponse({
        ok: true,
        summary: { description, agenda, discussion_points: discussionPoints },
      })
    }

    // Create / Update Task (authorized registered/organizer users)
    if (action === 'upsert_task') {
      if (!access.authorized || !caller) {
        return jsonResponse({ error: 'Only authorized signed-in participants can modify meeting tasks.' }, 403)
      }

      const taskId = String(body.task_id ?? '').trim()
      const title = String(body.title ?? '').trim()
      if (!title) return jsonResponse({ error: 'Task title is required.' }, 400)

      const rawStatus = String(body.status ?? 'pending')
      const isCompleted = body.is_completed !== undefined ? Boolean(body.is_completed) : rawStatus === 'completed'
      const normalizedStatus = isCompleted
        ? 'completed'
        : rawStatus === 'in_progress'
          ? 'in_progress'
          : 'pending'
      const assignedTo = String(body.assigned_to ?? '').trim()
      const dueDate = body.due_date ? String(body.due_date).slice(0, 10) : null

      if (taskId) {
        const { data: updated, error: taskErr } = await supabaseAdmin
          .from('meeting_tasks')
          .update({
            title,
            status: normalizedStatus,
            is_completed: isCompleted,
            assigned_to: assignedTo,
            due_date: dueDate,
          })
          .eq('id', taskId)
          .eq('meeting_id', meeting.id)
          .select('id, meeting_id, title, status, is_completed, assigned_to, due_date, created_by, created_at, updated_at')
          .single()

        if (taskErr) return jsonResponse({ error: taskErr.message }, 500)
        return jsonResponse({ task: updated })
      }

      const { data: created, error: insertErr } = await supabaseAdmin
        .from('meeting_tasks')
        .insert({
          meeting_id: meeting.id,
          title,
          status: normalizedStatus,
          is_completed: isCompleted,
          assigned_to: assignedTo,
          due_date: dueDate,
          created_by: caller.id,
        })
        .select('id, meeting_id, title, status, is_completed, assigned_to, due_date, created_by, created_at, updated_at')
        .single()

      if (insertErr) return jsonResponse({ error: insertErr.message }, 500)
      return jsonResponse({ task: created })
    }

    // Delete Task (authorized registered/organizer users)
    if (action === 'delete_task') {
      if (!access.authorized || !caller) {
        return jsonResponse({ error: 'Only authorized signed-in participants can remove tasks.' }, 403)
      }
      const taskId = String(body.task_id ?? '').trim()
      if (!taskId) return jsonResponse({ error: 'task_id is required.' }, 400)

      const { error: delErr } = await supabaseAdmin
        .from('meeting_tasks')
        .delete()
        .eq('id', taskId)
        .eq('meeting_id', meeting.id)

      if (delErr) return jsonResponse({ error: delErr.message }, 500)
      return jsonResponse({ ok: true, deleted_task_id: taskId })
    }

    // Persist Real-Time Room Chat Message (any admitted organizer, registered user, or verified guest)
    if (action === 'send_chat') {
      if (!access.authorized) {
        return jsonResponse({ error: 'Unauthorized room chat message.' }, 403)
      }
      const messageText = String(body.message_text ?? '').trim()
      const participantIdentity = String(body.participant_identity ?? '').trim()
      let senderName = String(body.sender_name ?? '').trim()

      if (!messageText) return jsonResponse({ error: 'Message text cannot be empty.' }, 400)
      if (!participantIdentity) return jsonResponse({ error: 'participant_identity is required.' }, 400)

      if (caller) {
        const { data: prof } = await supabaseAdmin
          .from('profiles')
          .select('full_name')
          .eq('id', caller.id)
          .maybeSingle()
        senderName = prof?.full_name || senderName || String(caller.user_metadata?.full_name || caller.email?.split('@')[0] || 'Participant')
      } else if (!senderName) {
        senderName = 'Guest'
      }

      const { data: msgRow, error: msgErr } = await supabaseAdmin
        .from('meeting_messages')
        .insert({
          meeting_id: meeting.id,
          user_id: caller?.id ?? null,
          participant_identity: participantIdentity,
          sender_name: senderName,
          sender_role: access.participantType,
          message_text: messageText,
        })
        .select('id, meeting_id, user_id, participant_identity, sender_name, sender_role, message_text, created_at')
        .single()

      if (msgErr) return jsonResponse({ error: msgErr.message }, 500)
      return jsonResponse({ message: msgRow })
    }

    // Leave recording
    if (action === 'leave') {
      const participantIdentity = String(body.participant_identity || '')
      const participantId = String(body.participant_id || '')
      if (!participantId && !participantIdentity) {
        return jsonResponse({ error: 'participant_id or participant_identity is required.' }, 400)
      }
      if (!access.authorized) {
        return jsonResponse({ error: 'Unauthorized leave request.' }, 403)
      }

      const nowIso = new Date().toISOString()
      let q = supabaseAdmin
        .from('meeting_participants')
        .update({ left_at: nowIso })
        .eq('meeting_id', meeting.id)

      if (participantId) {
        q = q.eq('id', participantId)
      } else {
        q = q.eq('participant_identity', participantIdentity)
      }
      if (caller && !access.isOrganizer) {
        q = q.eq('user_id', caller.id)
      }
      await q
      return jsonResponse({ ok: true })
    }

    // Organizer-only meeting management actions (`end_meeting`, `admit_participant`, `remove_participant`, `set_recording`)
    if (
      action === 'end_meeting' ||
      action === 'admit_participant' ||
      action === 'remove_participant' ||
      action === 'set_recording'
    ) {
      if (!caller || caller.id !== meeting.organizer_id) {
        return jsonResponse({ error: 'Only the meeting organizer can perform this action.' }, 403)
      }

      const livekitUrl = Deno.env.get('LIVEKIT_URL') ?? ''
      const apiKey = Deno.env.get('LIVEKIT_API_KEY') ?? ''
      const apiSecret = Deno.env.get('LIVEKIT_API_SECRET') ?? ''

      if (action === 'set_recording') {
        const nextStatus = String(body.recording_status ?? 'idle')
        if (!['idle', 'recording', 'paused'].includes(nextStatus)) {
          return jsonResponse({ error: 'Invalid recording status.' }, 400)
        }
        const startedAt =
          nextStatus === 'recording'
            ? meeting.recording_started_at ?? new Date().toISOString()
            : nextStatus === 'idle'
              ? null
              : meeting.recording_started_at

        await supabaseAdmin
          .from('meetings')
          .update({
            recording_status: nextStatus,
            recording_started_at: startedAt,
          })
          .eq('id', meeting.id)

        return jsonResponse({
          ok: true,
          recording_status: nextStatus,
          recording_started_at: startedAt,
        })
      }

      if (action === 'end_meeting') {
        const nowIso = new Date().toISOString()
        await supabaseAdmin
          .from('meetings')
          .update({ meeting_status: 'ended', ended_at: nowIso, recording_status: 'idle' })
          .eq('id', meeting.id)

        await supabaseAdmin
          .from('meeting_participants')
          .update({ left_at: nowIso })
          .eq('meeting_id', meeting.id)
          .is('left_at', null)

        if (livekitUrl && apiKey && apiSecret) {
          await callLiveKitRoomService(livekitUrl, apiKey, apiSecret, 'DeleteRoom', { room: meeting.id })
        }

        return jsonResponse({ ok: true, meeting_status: 'ended' })
      }

      const targetParticipantId = String(body.target_participant_id || '')
      if (!targetParticipantId) {
        return jsonResponse({ error: 'target_participant_id is required.' }, 400)
      }

      if (action === 'admit_participant') {
        await supabaseAdmin
          .from('meeting_participants')
          .update({ admission_status: 'admitted' })
          .eq('id', targetParticipantId)
          .eq('meeting_id', meeting.id)
        return jsonResponse({ ok: true, admission_status: 'admitted' })
      }

      // Remove / reject participant
      const { data: removedRow } = await supabaseAdmin
        .from('meeting_participants')
        .update({ admission_status: 'removed', left_at: new Date().toISOString() })
        .eq('id', targetParticipantId)
        .eq('meeting_id', meeting.id)
        .neq('participant_type', 'organizer')
        .select('participant_identity')
        .maybeSingle()

      if (removedRow?.participant_identity && livekitUrl && apiKey && apiSecret) {
        await callLiveKitRoomService(livekitUrl, apiKey, apiSecret, 'RemoveParticipant', {
          room: meeting.id,
          identity: removedRow.participant_identity,
        })
      }

      return jsonResponse({ ok: true, admission_status: 'removed' })
    }

    // Main join & token issuance (`join_token`)
    if (!access.authorized) {
      return jsonResponse({ error: access.reason }, 403)
    }

    if (meeting.meeting_status === 'ended' || meeting.meeting_status === 'cancelled') {
      return jsonResponse({ error: `This meeting has already ${meeting.meeting_status}.` }, 403)
    }

    // Resolve participant profile details
    let fullName = String(body.full_name || body.guest_name || '').trim()
    let participantEmail: string | null = String(body.email || body.guest_email || '').trim().toLowerCase() || null

    if (caller) {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('id', caller.id)
        .maybeSingle()

      fullName = prof?.full_name || fullName || String(caller.user_metadata?.full_name || caller.email?.split('@')[0] || 'Participant')
      participantEmail = (prof?.email || caller.email || participantEmail)?.toLowerCase() ?? null
    } else if (!fullName) {
      return jsonResponse({ error: 'Full Name is required to join as a guest.' }, 400)
    }

    // If Organizer joins a scheduled meeting, mark it active automatically
    let currentStatus = meeting.meeting_status
    if (access.isOrganizer && currentStatus === 'scheduled') {
      const nowIso = new Date().toISOString()
      await supabaseAdmin
        .from('meetings')
        .update({ meeting_status: 'active', started_at: meeting.started_at ?? nowIso })
        .eq('id', meeting.id)
      currentStatus = 'active'
    }

    // Mark personal invitation accepted
    if (access.matchedInvitationId) {
      await supabaseAdmin
        .from('meeting_invitations')
        .update({ invitation_status: 'accepted' })
        .eq('id', access.matchedInvitationId)
        .eq('invitation_status', 'pending')
    }

    const existingIdentity = String(body.participant_identity || '').trim()
    const participantIdentity = access.isOrganizer
      ? `org_${caller!.id}`
      : caller
        ? `user_${caller.id}`
        : existingIdentity && existingIdentity.startsWith('guest_')
          ? existingIdentity
          : `guest_${crypto.randomUUID().slice(0, 12)}`

    // Enforce admission check / waiting room state
    const { data: existingParticipant } = await supabaseAdmin
      .from('meeting_participants')
      .select('id, admission_status')
      .eq('meeting_id', meeting.id)
      .eq('participant_identity', participantIdentity)
      .maybeSingle()

    if (existingParticipant?.admission_status === 'removed' && !access.isOrganizer) {
      return jsonResponse({ error: 'You have been removed from this meeting by the organizer.' }, 403)
    }

    const needsWaiting =
      !access.isOrganizer &&
      (currentStatus === 'scheduled' ||
        (meeting.waiting_room_enabled && existingParticipant?.admission_status !== 'admitted'))

    const nextAdmissionStatus = needsWaiting ? 'waiting' : 'admitted'
    const nowIso = new Date().toISOString()

    const { data: participantRow, error: partErr } = await supabaseAdmin
      .from('meeting_participants')
      .upsert(
        {
          meeting_id: meeting.id,
          user_id: caller?.id ?? null,
          full_name: fullName,
          email: participantEmail,
          participant_type: access.participantType,
          participant_identity: participantIdentity,
          admission_status: nextAdmissionStatus,
          joined_at: nowIso,
          left_at: null,
        },
        { onConflict: 'meeting_id,participant_identity' }
      )
      .select('id, participant_identity, participant_type, admission_status, full_name')
      .single()

    if (partErr || !participantRow) {
      return jsonResponse({ error: partErr?.message ?? 'Failed to register meeting participant.' }, 500)
    }

    if (needsWaiting) {
      return jsonResponse({
        status: 'waiting_room',
        reason: currentStatus === 'scheduled' ? 'waiting_for_host' : 'waiting_for_admission',
        participant_id: participantRow.id,
        participant_identity: participantRow.participant_identity,
        participant_type: participantRow.participant_type,
        is_organizer: false,
        meeting: {
          id: meeting.id,
          meeting_code: meeting.meeting_code,
          meeting_title: meeting.meeting_title,
          meeting_status: currentStatus,
          waiting_room_enabled: meeting.waiting_room_enabled,
          description: meeting.description,
          agenda: meeting.agenda,
          discussion_points: meeting.discussion_points,
          recording_status: meeting.recording_status,
          recording_started_at: meeting.recording_started_at,
          scheduled_at: meeting.scheduled_at,
          organizer_name: meeting.organizer?.full_name ?? 'Meeting Host',
        },
      })
    }

    const livekitUrl = Deno.env.get('LIVEKIT_URL') ?? ''
    const apiKey = Deno.env.get('LIVEKIT_API_KEY') ?? ''
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET') ?? ''

    if (!livekitUrl || !apiKey || !apiSecret) {
      return jsonResponse(
        {
          error:
            'LiveKit server credentials (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) are missing in Supabase Edge Function Secrets.',
        },
        500
      )
    }

    const token = await mintLiveKitToken({
      apiKey,
      apiSecret,
      identity: participantIdentity,
      name: fullName,
      roomName: meeting.id,
      isOrganizer: access.isOrganizer,
      metadata: {
        participantType: access.participantType,
        fullName,
      },
    })

    return jsonResponse({
      status: 'admitted',
      token,
      server_url: livekitUrl,
      room_name: meeting.id,
      participant_id: participantRow.id,
      participant_identity: participantRow.participant_identity,
      participant_type: participantRow.participant_type,
      is_organizer: access.isOrganizer,
      can_edit_workspace: Boolean(caller) && access.authorized,
      meeting: {
        id: meeting.id,
        meeting_code: meeting.meeting_code,
        meeting_title: meeting.meeting_title,
        meeting_status: currentStatus,
        waiting_room_enabled: meeting.waiting_room_enabled,
        description: meeting.description,
        agenda: meeting.agenda,
        discussion_points: meeting.discussion_points,
        recording_status: meeting.recording_status,
        recording_started_at: meeting.recording_started_at,
        scheduled_at: meeting.scheduled_at,
        organizer_name: meeting.organizer?.full_name ?? 'Meeting Host',
      },
    })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected LiveKit token error' }, 500)
  }
})
