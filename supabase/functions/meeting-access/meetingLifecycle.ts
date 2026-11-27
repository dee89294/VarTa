import { jsonResponse } from './shared.ts'
import { buildMeetingInviteHtml, dispatchEmail } from './emailSender.ts'

export async function handleDispatchScheduleInvites(
  supabaseAdmin: any,
  meeting: any,
  callerEmp: any,
  isOrganizer: boolean,
  isAdmin: boolean
) {
  if (!isOrganizer && !isAdmin) {
    return jsonResponse({ error: 'Only the organizer or Super Admin can dispatch meeting invitations.' }, 403)
  }

  const { data: invitees } = await supabaseAdmin
    .from('meeting_participants')
    .select('employee_id, invited_email, employee:employees!meeting_participants_employee_id_fkey(id, email, full_name, status)')
    .eq('meeting_id', meeting.id)
    .neq('employee_id', callerEmp.id)

  const recipientEmails = (invitees ?? [])
    .map((row: any) => row.employee)
    .filter((e: any) => e && e.status === 'active' && e.email)
    .map((e: any) => e.email)

  const appUrl = (Deno.env.get('APP_URL') || 'http://localhost:5173').replace(/\/+$/, '')
  const joinUrl = appUrl + '/meetings/' + meeting.id

  const emailHtml = buildMeetingInviteHtml({
    title: meeting.title,
    meetingCode: meeting.meeting_code,
    hostName: callerEmp.full_name,
    hostEmail: callerEmp.email,
    scheduledStart: meeting.scheduled_start,
    durationMinutes: meeting.duration_minutes,
    joinUrl,
    description: meeting.description,
  })

  const dispatchRes = await dispatchEmail({
    supabaseAdmin,
    to: recipientEmails,
    subject: 'Meeting Invitation: ' + meeting.title + ' (' + meeting.meeting_code + ')',
    html: emailHtml,
  })

  await supabaseAdmin.from('meeting_activity_logs').insert({
    meeting_id: meeting.id,
    actor_employee_id: callerEmp.id,
    action: 'invitations_dispatched',
    details: {
      count: recipientEmails.length,
      email_status: dispatchRes.status,
      provider: dispatchRes.provider,
      recipient_emails: recipientEmails,
    },
  })

  return jsonResponse({
    ok: true,
    invited_emails: recipientEmails,
    email_status: dispatchRes.status,
    provider: dispatchRes.provider,
  })
}

export async function handleInviteParticipants(
  supabaseAdmin: any,
  meeting: any,
  callerEmp: any,
  body: any,
  isOrganizer: boolean,
  isAdmin: boolean
) {
  if (!isOrganizer && !isAdmin) {
    return jsonResponse({ error: 'Only the organizer or Super Admin can invite participants.' }, 403)
  }
  const employeeIds = Array.isArray(body?.employee_ids) ? (body.employee_ids as string[]) : []
  if (employeeIds.length === 0) {
    return jsonResponse({ error: 'employee_ids array is required' }, 400)
  }

  const invitationSource = String(body?.invitation_source || 'individual')
  const { data: activeInvitees } = await supabaseAdmin
    .from('employees')
    .select('id, email, full_name, employee_code')
    .in('id', employeeIds)
    .eq('status', 'active')

  const validEmployees = activeInvitees ?? []
  if (validEmployees.length === 0) {
    return jsonResponse({ error: 'No active employees found in the selected participant list.' }, 400)
  }

  const validIds = validEmployees.map((e: any) => e.id)
  const nowIso = new Date().toISOString()

  await supabaseAdmin.from('meeting_participants').upsert(
    validEmployees.map((emp: any) => ({
      meeting_id: meeting.id,
      employee_id: emp.id,
      role_in_meeting: emp.id === meeting.organizer_id ? 'organizer' : 'participant',
      admission_status: 'invited',
      invited_by: callerEmp.id,
      invitation_source: invitationSource,
      invited_email: emp.email,
      invitation_sent_at: nowIso,
    })),
    { onConflict: 'meeting_id,employee_id' }
  )

  if (meeting.status === 'live') {
    const { data: existingAtt } = await supabaseAdmin
      .from('attendance')
      .select('employee_id')
      .eq('meeting_id', meeting.id)
    const existingSet = new Set((existingAtt ?? []).map((a: any) => a.employee_id))
    const toSeed = validIds
      .filter((eid: string) => !existingSet.has(eid))
      .map((eid: string) => ({
        meeting_id: meeting.id,
        employee_id: eid,
        status: 'absent',
        verified_entry: false,
      }))
    if (toSeed.length > 0) {
      await supabaseAdmin.from('attendance').insert(toSeed)
    }
  }

  const recipientsToNotify = validEmployees.filter((emp: any) => emp.id !== callerEmp.id)
  if (recipientsToNotify.length > 0) {
    await supabaseAdmin.from('notifications').insert(
      recipientsToNotify.map((emp: any) => ({
        recipient_employee_id: emp.id,
        meeting_id: meeting.id,
        type: 'meeting_invited',
        title: meeting.status === 'live' ? 'Invited to Live Meeting' : 'Invited to Meeting',
        message: callerEmp.full_name + ' invited your official email (' + emp.email + ') to "' + meeting.title + '".',
      }))
    )
  }

  const appUrl = (Deno.env.get('APP_URL') || 'http://localhost:5173').replace(/\/+$/, '')
  const joinUrl = appUrl + '/meetings/' + meeting.id

  const emailHtml = buildMeetingInviteHtml({
    title: meeting.title,
    meetingCode: meeting.meeting_code,
    hostName: callerEmp.full_name,
    hostEmail: callerEmp.email,
    scheduledStart: meeting.scheduled_start,
    durationMinutes: meeting.duration_minutes,
    joinUrl,
    description: meeting.description,
  })

  const recipientEmails = recipientsToNotify.map((r: any) => r.email)
  const dispatchRes = await dispatchEmail({
    supabaseAdmin,
    to: recipientEmails,
    subject: 'Meeting Invitation: ' + meeting.title + ' (' + meeting.meeting_code + ')',
    html: emailHtml,
  })

  await supabaseAdmin.from('meeting_activity_logs').insert({
    meeting_id: meeting.id,
    actor_employee_id: callerEmp.id,
    action: 'invitations_dispatched',
    details: {
      count: validEmployees.length,
      source: invitationSource,
      email_status: dispatchRes.status,
      provider: dispatchRes.provider,
      recipient_emails: validEmployees.map((e: any) => e.email),
    },
  })

  return jsonResponse({
    ok: true,
    invited_count: validEmployees.length,
    invited_emails: validEmployees.map((e: any) => e.email),
    email_status: dispatchRes.status,
    provider: dispatchRes.provider,
  })
}

export async function handleCancelMeeting(
  supabaseAdmin: any,
  meeting: any,
  callerEmp: any,
  isOrganizer: boolean,
  isAdmin: boolean
) {
  if (!isOrganizer && !isAdmin) {
    return jsonResponse({ error: 'Only the organizer or Super Admin can cancel this meeting.' }, 403)
  }

  const { data: cancelledMeeting, error: cancelErr } = await supabaseAdmin
    .from('meetings')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', meeting.id)
    .select('*')
    .single()

  if (cancelErr) {
    return jsonResponse({ error: cancelErr.message }, 500)
  }

  const { data: invitees } = await supabaseAdmin
    .from('meeting_participants')
    .select('employee_id, invited_email, employee:employees!meeting_participants_employee_id_fkey(id, email, full_name, status)')
    .eq('meeting_id', meeting.id)
    .neq('employee_id', callerEmp.id)

  const recipientEmails = (invitees ?? [])
    .map((row: any) => row.employee)
    .filter((e: any) => e && e.status === 'active' && e.email)
    .map((e: any) => e.email)

  const notifs = (invitees ?? []).map((row: any) => ({
    recipient_employee_id: row.employee_id,
    meeting_id: meeting.id,
    type: 'meeting_cancelled',
    title: 'Meeting Cancelled',
    message: callerEmp.full_name + ' has cancelled scheduled meeting "' + meeting.title + '" (' + meeting.meeting_code + ').',
  }))
  if (notifs.length > 0) {
    await supabaseAdmin.from('notifications').insert(notifs)
  }

  const cancelHtml = '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #E5E8F2; border-radius: 16px; background: #ffffff;">' +
    '<div style="border-bottom: 2px solid #F03E3E; padding-bottom: 12px; margin-bottom: 16px;">' +
    '<h2 style="color: #F03E3E; margin: 0; font-size: 20px;">Meeting Cancelled</h2>' +
    '<p style="color: #6E748C; font-size: 13px; margin: 4px 0 0;">Notice from ' + callerEmp.full_name + '</p>' +
    '</div>' +
    '<p style="color: #151722; font-size: 15px; line-height: 1.5;">' +
    'The scheduled meeting <strong>' + meeting.title + '</strong> (<code>' + meeting.meeting_code + '</code>) has been cancelled by the host.' +
    '</p>' +
    '<div style="background: #F8F9FD; border-radius: 12px; padding: 14px; margin: 16px 0; font-size: 13px; color: #454A62;">' +
    '<div><strong>Originally Scheduled:</strong> ' + meeting.scheduled_start + '</div>' +
    '<div><strong>Host:</strong> ' + callerEmp.full_name + '</div>' +
    '</div>' +
    '<p style="color: #8D92A8; font-size: 11px; margin-top: 24px; border-top: 1px solid #EEF0F7; padding-top: 12px;">' +
    'VarTa Enterprise Meetings • Automated Notification' +
    '</p>' +
    '</div>'

  await dispatchEmail({
    supabaseAdmin,
    to: recipientEmails,
    subject: 'Meeting Cancelled: ' + meeting.title + ' (' + meeting.meeting_code + ')',
    html: cancelHtml,
  })

  await supabaseAdmin.from('meeting_activity_logs').insert({
    meeting_id: meeting.id,
    actor_employee_id: callerEmp.id,
    action: 'meeting_cancelled',
    details: { cancelled_by: callerEmp.full_name, recipient_count: recipientEmails.length },
  })

  return jsonResponse({ ok: true, meeting: cancelledMeeting })
}

export async function handleTestSmtp(
  supabaseAdmin: any,
  callerEmp: any,
  callerRole: string,
  user: any,
  body: any
) {
  if (callerRole !== 'super_admin') {
    return jsonResponse({ error: 'Only Super Admins can test SMTP configuration.' }, 403)
  }
  const targetEmail = String(body?.target_email || callerEmp.email || user.email)
  const testHtml = '<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #E5E8F2; border-radius: 16px;">' +
    '<h2 style="color: #4D4CEF; margin-top: 0;">VarTa SMTP Test Successful</h2>' +
    '<p style="color: #151722; font-size: 14px;">Your SMTP configuration is active and able to transmit email notifications.</p>' +
    '<div style="font-size: 12px; color: #6E748C; background: #F8F9FD; padding: 12px; border-radius: 8px; margin-top: 16px;">' +
    '<div><strong>Tested At:</strong> ' + new Date().toISOString() + '</div>' +
    '<div><strong>Recipient:</strong> ' + targetEmail + '</div>' +
    '<div><strong>Admin:</strong> ' + callerEmp.full_name + ' (' + callerEmp.employee_code + ')</div>' +
    '</div>' +
    '</div>'

  const dispatchResult = await dispatchEmail({
    supabaseAdmin,
    to: [targetEmail],
    subject: 'VarTa SMTP Test: Connection Successful',
    html: testHtml,
  })

  return jsonResponse({
    ok: dispatchResult.status === 'sent',
    status: dispatchResult.status,
    provider: dispatchResult.provider,
    message: dispatchResult.status === 'sent'
      ? 'Test email dispatched successfully'
      : (dispatchResult as { message?: string }).message || 'Could not send test email. Check server logs and credentials.',
  })
}

export async function handleEndMeeting(
  supabaseAdmin: any,
  meeting: any,
  callerEmp: any,
  isOrganizer: boolean,
  isAdmin: boolean
) {
  if (!isOrganizer && !isAdmin) {
    return jsonResponse({ error: 'Only the organizer or Super Admin can end this meeting.' }, 403)
  }

  const nowIso = new Date().toISOString()
  const { data: endedMeeting } = await supabaseAdmin
    .from('meetings')
    .update({
      status: 'completed',
      actual_ended_at: nowIso,
    })
    .eq('id', meeting.id)
    .select('*')
    .single()

  const { data: activeAttendees } = await supabaseAdmin
    .from('attendance')
    .select('*')
    .eq('meeting_id', meeting.id)
    .eq('status', 'present')
    .is('leave_time', null)

  for (const att of activeAttendees ?? []) {
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
  }

  await supabaseAdmin
    .from('attendance')
    .update({ status: 'absent' })
    .eq('meeting_id', meeting.id)
    .eq('verified_entry', false)

  const { data: invitees } = await supabaseAdmin
    .from('meeting_participants')
    .select('employee_id')
    .eq('meeting_id', meeting.id)
    .in('admission_status', ['invited', 'waiting', 'admitted'])

  const { data: existingAtt } = await supabaseAdmin
    .from('attendance')
    .select('employee_id')
    .eq('meeting_id', meeting.id)
  const existingSet = new Set((existingAtt ?? []).map((a: any) => a.employee_id))

  const missingAbsent = (invitees ?? [])
    .filter((i: any) => !existingSet.has(i.employee_id))
    .map((i: any) => ({
      meeting_id: meeting.id,
      employee_id: i.employee_id,
      status: 'absent',
      verified_entry: false,
    }))

  if (missingAbsent.length > 0) {
    await supabaseAdmin.from('attendance').insert(missingAbsent)
  }

  await supabaseAdmin.from('meeting_activity_logs').insert({
    meeting_id: meeting.id,
    actor_employee_id: callerEmp.id,
    action: 'meeting_ended',
    details: { title: meeting.title },
  })

  const notifyIds = (invitees ?? []).map((i: any) => i.employee_id)
  if (notifyIds.length > 0) {
    await supabaseAdmin.from('notifications').insert(
      notifyIds.map((id: string) => ({
        recipient_employee_id: id,
        meeting_id: meeting.id,
        type: 'meeting_ended',
        title: 'Meeting Ended & Attendance Saved',
        message: '"' + meeting.title + '" has ended. Final attendance report has been generated.',
      }))
    )
  }

  return jsonResponse({ ok: true, meeting: endedMeeting })
}
