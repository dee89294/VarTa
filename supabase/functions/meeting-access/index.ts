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
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function getSecretKey(): string {
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw)
      if (parsed?.default) return parsed.default
    } catch {
      // ignore
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface SmtpSettings {
  host: string
  port: number
  user?: string
  pass?: string
  secure?: boolean
  fromEmail: string
  fromName?: string
}

async function sendViaSmtp({
  to,
  subject,
  html,
  config,
}: {
  to: string[]
  subject: string
  html: string
  config: SmtpSettings
}): Promise<{ success: boolean; message: string }> {
  try {
    const port = config.port || (config.secure ? 465 : 587)
    let conn: Deno.Conn = config.secure
      ? await Deno.connectTls({ hostname: config.host, port })
      : await Deno.connect({ hostname: config.host, port })

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const buf = new Uint8Array(4096)

    async function readResponse(): Promise<string> {
      let result = ''
      while (true) {
        const n = await conn.read(buf)
        if (n === null) break
        const chunk = decoder.decode(buf.subarray(0, n))
        result += chunk
        const lines = result.trimEnd().split('\n')
        const lastLine = lines[lines.length - 1]
        if (/^\d{3}\s/.test(lastLine) || /^\d{3}$/.test(lastLine.trim())) {
          break
        }
      }
      return result
    }

    async function sendCommand(cmd: string): Promise<string> {
      await conn.write(encoder.encode(cmd + '\r\n'))
      return await readResponse()
    }

    const greeting = await readResponse()
    if (!greeting.startsWith('220')) {
      throw new Error(`SMTP greeting failed: ${greeting.trim()}`)
    }

    let ehloRes = await sendCommand('EHLO varta.io')

    if (!config.secure && (ehloRes.includes('STARTTLS') || port === 587)) {
      const tlsRes = await sendCommand('STARTTLS')
      if (tlsRes.startsWith('220')) {
        conn = await Deno.startTls(conn, { hostname: config.host })
        ehloRes = await sendCommand('EHLO varta.io')
      }
    }

    if (config.user && config.pass) {
      const authRes = await sendCommand('AUTH LOGIN')
      if (!authRes.startsWith('334')) {
        throw new Error(`AUTH LOGIN rejected: ${authRes.trim()}`)
      }
      const userRes = await sendCommand(btoa(config.user))
      if (!userRes.startsWith('334')) {
        throw new Error(`SMTP username rejected: ${userRes.trim()}`)
      }
      const passRes = await sendCommand(btoa(config.pass))
      if (!passRes.startsWith('235')) {
        throw new Error(`SMTP auth failed: ${passRes.trim()}`)
      }
    }

    const mailFromRes = await sendCommand(`MAIL FROM:<${config.fromEmail}>`)
    if (!mailFromRes.startsWith('250')) {
      throw new Error(`MAIL FROM failed: ${mailFromRes.trim()}`)
    }

    for (const recipient of to) {
      await sendCommand(`RCPT TO:<${recipient}>`)
    }

    const dataRes = await sendCommand('DATA')
    if (!dataRes.startsWith('354')) {
      throw new Error(`DATA failed: ${dataRes.trim()}`)
    }

    const fromHeader = config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail
    const emailData = [
      `From: ${fromHeader}`,
      `To: ${to.join(', ')}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      ``,
      html,
      `.`,
    ].join('\r\n')

    const transmitRes = await sendCommand(emailData)
    if (!transmitRes.startsWith('250')) {
      throw new Error(`Message body rejected: ${transmitRes.trim()}`)
    }

    await sendCommand('QUIT')
    conn.close()
    return { success: true, message: 'Delivered via SMTP' }
  } catch (err: any) {
    return { success: false, message: err?.message || 'SMTP error' }
  }
}

async function dispatchEmail({
  supabaseAdmin,
  to,
  subject,
  html,
}: {
  supabaseAdmin: any
  to: string[]
  subject: string
  html: string
}) {
  if (!to || to.length === 0) return { status: 'skipped', provider: 'none' }

  try {
    const { data: settings } = await supabaseAdmin
      .from('platform_settings')
      .select('smtp_enabled, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from_email, smtp_from_name')
      .eq('id', 1)
      .maybeSingle()

    const host = settings?.smtp_host || Deno.env.get('SMTP_HOST')
    const user = settings?.smtp_user || Deno.env.get('SMTP_USER')
    const pass = settings?.smtp_pass || Deno.env.get('SMTP_PASS')
    const port = Number(settings?.smtp_port || Deno.env.get('SMTP_PORT') || 587)
    const secure = settings?.smtp_secure ?? (port === 465)
    const fromEmail = settings?.smtp_from_email || Deno.env.get('VARTA_INVITE_FROM_EMAIL') || 'invites@varta.io'
    const fromName = settings?.smtp_from_name || 'VarTa Meetings'

    if ((settings?.smtp_enabled !== false) && host) {
      const smtpRes = await sendViaSmtp({
        to,
        subject,
        html,
        config: { host, port, user, pass, secure, fromEmail, fromName },
      })
      if (smtpRes.success) {
        return { status: 'sent', provider: 'smtp', message: smtpRes.message }
      }
      console.warn('SMTP connection failed, attempting fallback:', smtpRes.message)
    }
  } catch (e: any) {
    console.warn('Platform settings SMTP lookup error:', e?.message)
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: Deno.env.get('VARTA_INVITE_FROM_EMAIL') || 'VarTa Meetings <invites@varta.io>',
          to,
          subject,
          html,
        }),
      })
      if (emailRes.ok) {
        return { status: 'sent', provider: 'resend' }
      }
    } catch (e: any) {
      console.warn('Resend error:', e?.message)
    }
  }

  return { status: 'in_app_dispatched', provider: 'in_app' }
}

function buildMeetingInviteHtml({
  title,
  meetingCode,
  hostName,
  hostEmail,
  scheduledStart,
  durationMinutes,
  joinUrl,
  description,
}: {
  title: string
  meetingCode: string
  hostName: string
  hostEmail?: string
  scheduledStart: string
  durationMinutes: number
  joinUrl: string
  description?: string
}) {
  const hostDetail = hostEmail ? ' (' + hostEmail + ')' : ''
  const descBlock = description
    ? '<p style="color: #454A62; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">' + description + '</p>'
    : ''

  return [
    '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #E5E8F2; border-radius: 20px;">',
    '  <div style="margin-bottom: 20px;">',
    '    <span style="display: inline-block; background: #EFF1F8; color: #4D4CEF; border: 1px solid #DFE3F2; font-family: monospace; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px;">',
    '      ' + meetingCode,
    '    </span>',
    '    <h2 style="color: #151722; font-size: 22px; font-weight: 700; margin: 10px 0 4px 0;">',
    '      ' + title,
    '    </h2>',
    '    <p style="color: #6E748C; font-size: 13px; margin: 0;">',
    '      Invited by <strong>' + hostName + '</strong>' + hostDetail,
    '    </p>',
    '  </div>',
    '  ' + descBlock,
    '  <div style="background: #F8F9FD; border: 1px solid #E9ECF6; border-radius: 14px; padding: 16px; margin-bottom: 24px; font-size: 13px; color: #373A4D;">',
    '    <div style="margin-bottom: 8px;"><strong>Date & Time:</strong> ' + scheduledStart + '</div>',
    '    <div><strong>Duration:</strong> ' + durationMinutes + ' Minutes</div>',
    '  </div>',
    '  <div style="text-align: center; margin-bottom: 24px;">',
    '    <a href="' + joinUrl + '" style="display: inline-block; background: #4D4CEF; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 999px;">',
    '      Join Meeting',
    '    </a>',
    '    <div style="margin-top: 8px; font-size: 11px; color: #8D92A8;">',
    '      Link: <a href="' + joinUrl + '" style="color: #4D4CEF;">' + joinUrl + '</a>',
    '    </div>',
    '  </div>',
    '  <div style="border-top: 1px solid #EEF0F7; padding-top: 12px; font-size: 11px; color: #8D92A8;">',
    '    VarTa Enterprise Meeting Notification • Please sign in with your official account.',
    '  </div>',
    '</div>',
  ].join('\n')
}

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

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSecretKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    })

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
      if (callerRole !== 'super_admin') {
        return jsonResponse({ error: 'Only Super Admins can test SMTP configuration.' }, 403)
      }
      const targetEmail = String(body?.target_email || callerEmp.email || user.email)
      const testHtml = [
        '<div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #E5E8F2; border-radius: 16px;">',
        '  <h2 style="color: #4D4CEF; margin-top: 0;">VarTa SMTP Test Successful</h2>',
        '  <p style="color: #151722; font-size: 14px;">Your SMTP configuration is active and able to transmit email notifications.</p>',
        '  <div style="font-size: 12px; color: #6E748C; background: #F8F9FD; padding: 12px; border-radius: 8px; margin-top: 16px;">',
        '    <div><strong>Tested At:</strong> ' + new Date().toISOString() + '</div>',
        '    <div><strong>Recipient:</strong> ' + targetEmail + '</div>',
        '    <div><strong>Admin:</strong> ' + callerEmp.full_name + ' (' + callerEmp.employee_code + ')</div>',
        '  </div>',
        '</div>',
      ].join('\n')
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
        message: dispatchResult.status === 'sent' ? 'Test email dispatched successfully' : 'Could not send test email. Check server logs and credentials.',
      })
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
      if (!isOrganizer && !isAdmin) {
        return jsonResponse({ error: 'Only the organizer or Super Admin can invite participants.' }, 403)
      }
      const employeeIds = Array.isArray(body?.employee_ids) ? (body.employee_ids as string[]) : []
      if (employeeIds.length === 0) {
        return jsonResponse({ error: 'employee_ids array is required' }, 400)
      }

      const invitationSource = String(body?.invitation_source || 'individual') as
        | 'individual'
        | 'department'
        | 'department_heads'
        | 'managers'
        | 'leadership'

      // Enforce active-only employees rule on the server (inactive employees never invited)
      const { data: activeInvitees } = await supabaseAdmin
        .from('employees')
        .select('id, email, full_name, employee_code')
        .in('id', employeeIds)
        .eq('status', 'active')

      const validEmployees = activeInvitees ?? []
      if (validEmployees.length === 0) {
        return jsonResponse({ error: 'No active employees found in the selected participant list.' }, 400)
      }

      const validIds = validEmployees.map((e) => e.id)
      const nowIso = new Date().toISOString()

      await supabaseAdmin.from('meeting_participants').upsert(
        validEmployees.map((emp) => ({
          meeting_id,
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
          .eq('meeting_id', meeting_id)
        const existingSet = new Set((existingAtt ?? []).map((a) => a.employee_id))
        const toSeed = validIds
          .filter((eid) => !existingSet.has(eid))
          .map((eid) => ({
            meeting_id,
            employee_id: eid,
            status: 'absent',
            verified_entry: false,
          }))
        if (toSeed.length > 0) {
          await supabaseAdmin.from('attendance').insert(toSeed)
        }
      }

      const recipientsToNotify = validEmployees.filter((emp) => emp.id !== callerEmp.id)
      if (recipientsToNotify.length > 0) {
        await supabaseAdmin.from('notifications').insert(
          recipientsToNotify.map((emp) => ({
            recipient_employee_id: emp.id,
            meeting_id,
            type: 'meeting_invited',
            title: meeting.status === 'live' ? 'Invited to Live Meeting' : 'Invited to Meeting',
            message: `${callerEmp.full_name} invited your official email (${emp.email}) to "${meeting.title}".`,
          }))
        )
      }

      // Dispatches email invitation via configured SMTP or Resend
      const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173'
      const joinUrl = `${appUrl}/meetings/${meeting_id}`

      const emailHtml = buildMeetingInviteHtml({
        title: meeting.title,
        meetingCode: meeting.meeting_code,
        hostName: callerEmp.full_name,
        hostEmail: (callerEmp as any).email,
        scheduledStart: meeting.scheduled_start,
        durationMinutes: meeting.duration_minutes,
        joinUrl,
        description: meeting.description,
      })

      const recipientEmails = recipientsToNotify.map((r) => r.email)
      const dispatchRes = await dispatchEmail({
        supabaseAdmin,
        to: recipientEmails,
        subject: `Meeting Invitation: ${meeting.title} (${meeting.meeting_code})`,
        html: emailHtml,
      })

      await supabaseAdmin.from('meeting_activity_logs').insert({
        meeting_id,
        actor_employee_id: callerEmp.id,
        action: 'invitations_dispatched',
        details: {
          count: validEmployees.length,
          source: invitationSource,
          email_status: dispatchRes.status,
          provider: dispatchRes.provider,
          recipient_emails: validEmployees.map((e) => e.email),
        },
      })

      return jsonResponse({
        ok: true,
        invited_count: validEmployees.length,
        invited_emails: validEmployees.map((e) => e.email),
        email_status: dispatchRes.status,
        provider: dispatchRes.provider,
      })
    }

    if (action === 'dispatch_schedule_invites') {
      if (!isOrganizer && !isAdmin) {
        return jsonResponse({ error: 'Only the organizer or Super Admin can dispatch meeting invitations.' }, 403)
      }

      const { data: invitees } = await supabaseAdmin
        .from('meeting_participants')
        .select('employee_id, invited_email, employee:employees!meeting_participants_employee_id_fkey(id, email, full_name, status)')
        .eq('meeting_id', meeting_id)
        .neq('employee_id', callerEmp.id)

      const recipientEmails = (invitees ?? [])
        .map((row) => (row.employee as { email?: string; status?: string } | null))
        .filter((e) => e && e.status === 'active' && e.email)
        .map((e) => e!.email!)

      const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173'
      const joinUrl = `${appUrl}/meetings/${meeting_id}`

      const emailHtml = buildMeetingInviteHtml({
        title: meeting.title,
        meetingCode: meeting.meeting_code,
        hostName: callerEmp.full_name,
        hostEmail: (callerEmp as any).email,
        scheduledStart: meeting.scheduled_start,
        durationMinutes: meeting.duration_minutes,
        joinUrl,
        description: meeting.description,
      })

      const dispatchRes = await dispatchEmail({
        supabaseAdmin,
        to: recipientEmails,
        subject: `Meeting Invitation: ${meeting.title} (${meeting.meeting_code})`,
        html: emailHtml,
      })

      await supabaseAdmin.from('meeting_activity_logs').insert({
        meeting_id,
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

    if (action === 'cancel_meeting') {
      if (!isOrganizer && !isAdmin) {
        return jsonResponse({ error: 'Only the organizer or Super Admin can cancel this meeting.' }, 403)
      }

      const { data: cancelledMeeting, error: cancelErr } = await supabaseAdmin
        .from('meetings')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', meeting_id)
        .select('*')
        .single()

      if (cancelErr) {
        return jsonResponse({ error: cancelErr.message }, 500)
      }

      // Fetch all invitees to notify
      const { data: invitees } = await supabaseAdmin
        .from('meeting_participants')
        .select('employee_id, invited_email, employee:employees!meeting_participants_employee_id_fkey(id, email, full_name, status)')
        .eq('meeting_id', meeting_id)
        .neq('employee_id', callerEmp.id)

      const recipientEmails = (invitees ?? [])
        .map((row) => (row.employee as { email?: string; status?: string } | null))
        .filter((e) => e && e.status === 'active' && e.email)
        .map((e) => e!.email!)

      // Insert in-app notifications
      const notifs = (invitees ?? []).map((row) => ({
        recipient_employee_id: row.employee_id,
        meeting_id,
        type: 'meeting_cancelled',
        title: 'Meeting Cancelled',
        message: `${callerEmp.full_name} has cancelled scheduled meeting "${meeting.title}" (${meeting.meeting_code}).`,
      }))
      if (notifs.length > 0) {
        await supabaseAdmin.from('notifications').insert(notifs)
      }

      // Dispatch cancellation email
      const cancelHtml = [
        '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #E5E8F2; border-radius: 16px; background: #ffffff;">',
        '  <div style="border-bottom: 2px solid #F03E3E; padding-bottom: 12px; margin-bottom: 16px;">',
        '    <h2 style="color: #F03E3E; margin: 0; font-size: 20px;">Meeting Cancelled</h2>',
        '    <p style="color: #6E748C; font-size: 13px; margin: 4px 0 0;">Notice from ' + callerEmp.full_name + '</p>',
        '  </div>',
        '  <p style="color: #151722; font-size: 15px; line-height: 1.5;">',
        '    The scheduled meeting <strong>' + meeting.title + '</strong> (<code>' + meeting.meeting_code + '</code>) has been cancelled by the host.',
        '  </p>',
        '  <div style="background: #F8F9FD; border-radius: 12px; padding: 14px; margin: 16px 0; font-size: 13px; color: #454A62;">',
        '    <div><strong>Originally Scheduled:</strong> ' + meeting.scheduled_start + '</div>',
        '    <div><strong>Host:</strong> ' + callerEmp.full_name + '</div>',
        '  </div>',
        '  <p style="color: #8D92A8; font-size: 11px; margin-top: 24px; border-top: 1px solid #EEF0F7; padding-top: 12px;">',
        '    VarTa Enterprise Meetings • Automated Notification',
        '  </p>',
        '</div>',
      ].join('\n')
      await dispatchEmail({
        supabaseAdmin,
        to: recipientEmails,
        subject: 'Meeting Cancelled: ' + meeting.title + ' (' + meeting.meeting_code + ')',
        html: cancelHtml,
      })

      await supabaseAdmin.from('meeting_activity_logs').insert({
        meeting_id,
        actor_employee_id: callerEmp.id,
        action: 'meeting_cancelled',
        details: { cancelled_by: callerEmp.full_name, recipient_count: recipientEmails.length },
      })

      return jsonResponse({ ok: true, meeting: cancelledMeeting })
    }

    if (action === 'end_meeting') {
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
        .eq('id', meeting_id)
        .select('*')
        .single()

      // Finalize duration for active present attendees
      const { data: activeAttendees } = await supabaseAdmin
        .from('attendance')
        .select('*')
        .eq('meeting_id', meeting_id)
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

      // Mark anyone still waiting as absent (never verified entry)
      await supabaseAdmin
        .from('attendance')
        .update({ status: 'absent' })
        .eq('meeting_id', meeting_id)
        .eq('verified_entry', false)

      // Ensure all invited participants without an attendance row get an 'absent' row
      const { data: invitees } = await supabaseAdmin
        .from('meeting_participants')
        .select('employee_id')
        .eq('meeting_id', meeting_id)
        .in('admission_status', ['invited', 'waiting', 'admitted'])

      const { data: existingAtt } = await supabaseAdmin
        .from('attendance')
        .select('employee_id')
        .eq('meeting_id', meeting_id)
      const existingSet = new Set((existingAtt ?? []).map((a) => a.employee_id))

      const missingAbsent = (invitees ?? [])
        .filter((i) => !existingSet.has(i.employee_id))
        .map((i) => ({
          meeting_id,
          employee_id: i.employee_id,
          status: 'absent',
          verified_entry: false,
        }))

      if (missingAbsent.length > 0) {
        await supabaseAdmin.from('attendance').insert(missingAbsent)
      }

      await supabaseAdmin.from('meeting_activity_logs').insert({
        meeting_id,
        actor_employee_id: callerEmp.id,
        action: 'meeting_ended',
        details: { title: meeting.title },
      })

      const notifyIds = (invitees ?? []).map((i) => i.employee_id)
      if (notifyIds.length > 0) {
        await supabaseAdmin.from('notifications').insert(
          notifyIds.map((id) => ({
            recipient_employee_id: id,
            meeting_id,
            type: 'meeting_ended',
            title: 'Meeting Ended & Attendance Saved',
            message: `"${meeting.title}" has ended. Final attendance report has been generated.`,
          }))
        )
      }

      return jsonResponse({ ok: true, meeting: endedMeeting })
    }

    return jsonResponse({ error: 'Unsupported action' }, 400)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error' }, 500)
  }
})
