export interface SmtpSettings {
  host: string
  port: number
  user?: string
  pass?: string
  secure?: boolean
  fromEmail: string
  fromName?: string
}

export async function sendViaSmtp({
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
      throw new Error('SMTP greeting failed: ' + greeting.trim())
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
        throw new Error('AUTH LOGIN rejected: ' + authRes.trim())
      }
      const userRes = await sendCommand(btoa(config.user))
      if (!userRes.startsWith('334')) {
        throw new Error('SMTP user rejected: ' + userRes.trim())
      }
      const passRes = await sendCommand(btoa(config.pass))
      if (!passRes.startsWith('235')) {
        throw new Error('SMTP auth failed: ' + passRes.trim())
      }
    }

    const mailFromRes = await sendCommand('MAIL FROM:<' + config.fromEmail + '>')
    if (!mailFromRes.startsWith('250')) {
      throw new Error('MAIL FROM failed: ' + mailFromRes.trim())
    }

    for (const recipient of to) {
      await sendCommand('RCPT TO:<' + recipient + '>')
    }

    const dataRes = await sendCommand('DATA')
    if (!dataRes.startsWith('354')) {
      throw new Error('DATA rejected: ' + dataRes.trim())
    }

    const fromHeader = config.fromName ? '"' + config.fromName + '" <' + config.fromEmail + '>' : config.fromEmail
    const emailData = [
      'From: ' + fromHeader,
      'To: ' + to.join(', '),
      'Subject: ' + subject,
      'Date: ' + new Date().toUTCString(),
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
      '.',
    ].join('\r\n')

    const transmitRes = await sendCommand(emailData)
    if (!transmitRes.startsWith('250')) {
      throw new Error('Message transmission failed: ' + transmitRes.trim())
    }

    await sendCommand('QUIT')
    conn.close()
    return { success: true, message: 'Delivered via SMTP' }
  } catch (err: any) {
    return { success: false, message: err?.message || 'SMTP delivery failed' }
  }
}

export async function dispatchEmail({
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

  let dbFromEmail = ''
  let dbFromName = ''
  try {
    const { data: settings } = await supabaseAdmin
      .from('platform_settings')
      .select('smtp_enabled, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from_email, smtp_from_name')
      .eq('id', 1)
      .maybeSingle()

    const useDbSmtp = Boolean(settings?.smtp_enabled && settings?.smtp_host)
    const host = useDbSmtp ? settings.smtp_host : Deno.env.get('SMTP_HOST')
    const user = useDbSmtp ? settings?.smtp_user : Deno.env.get('SMTP_USER')
    const pass = useDbSmtp ? settings?.smtp_pass : Deno.env.get('SMTP_PASS')
    const port = Number((useDbSmtp ? settings?.smtp_port : Deno.env.get('SMTP_PORT')) || 587)
    const secure = useDbSmtp
      ? (settings?.smtp_secure ?? (port === 465))
      : (Deno.env.get('SMTP_SECURE') === 'true' || port === 465)

    dbFromEmail = settings?.smtp_from_email || ''
    dbFromName = settings?.smtp_from_name || ''
    const fromEmail = dbFromEmail || Deno.env.get('VARTA_INVITE_FROM_EMAIL') || 'invites@varta.io'
    const fromName = dbFromName || Deno.env.get('SMTP_FROM_NAME') || 'VarTa Meetings'

    if (host) {
      const smtpRes = await sendViaSmtp({
        to,
        subject,
        html,
        config: { host, port, user, pass, secure, fromEmail, fromName },
      })
      if (smtpRes.success) {
        return { status: 'sent', provider: 'smtp', message: smtpRes.message }
      }
      console.warn('SMTP error:', smtpRes.message)
    }
  } catch (e: any) {
    console.warn('Settings lookup error:', e?.message)
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    try {
      const resendFrom =
        Deno.env.get('VARTA_INVITE_FROM_EMAIL') ||
        (dbFromEmail ? (dbFromName ? `${dbFromName} <${dbFromEmail}>` : dbFromEmail) : 'VarTa Meetings <invites@varta.io>')
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + resendKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: resendFrom,
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

export function buildMeetingInviteHtml({
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
  const hostLabel = hostEmail ? hostName + ' (' + hostEmail + ')' : hostName
  return '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #E5E8F2; border-radius: 20px;">' +
    '<div style="margin-bottom: 20px;">' +
      '<span style="display: inline-block; background: #EFF1F8; color: #4D4CEF; border: 1px solid #DFE3F2; font-family: monospace; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px;">' + meetingCode + '</span>' +
      '<h2 style="color: #151722; font-size: 22px; font-weight: 700; margin: 10px 0 4px 0;">' + title + '</h2>' +
      '<p style="color: #6E748C; font-size: 13px; margin: 0;">Invited by <strong>' + hostLabel + '</strong></p>' +
    '</div>' +
    (description ? '<p style="color: #454A62; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">' + description + '</p>' : '') +
    '<div style="background: #F8F9FD; border: 1px solid #E9ECF6; border-radius: 14px; padding: 16px; margin-bottom: 24px; font-size: 13px; color: #373A4D;">' +
      '<div style="margin-bottom: 8px;"><strong>Date & Time:</strong> ' + scheduledStart + '</div>' +
      '<div><strong>Duration:</strong> ' + durationMinutes + ' Minutes</div>' +
    '</div>' +
    '<div style="text-align: center; margin-bottom: 24px;">' +
      '<a href="' + joinUrl + '" style="display: inline-block; background: #4D4CEF; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 999px;">Join Meeting Room</a>' +
      '<div style="margin-top: 8px; font-size: 11px; color: #8D92A8;">Link: <a href="' + joinUrl + '" style="color: #4D4CEF;">' + joinUrl + '</a></div>' +
    '</div>' +
    '<div style="border-top: 1px solid #EEF0F7; padding-top: 12px; font-size: 11px; color: #8D92A8;">VarTa Enterprise Meeting Notification • Please sign in with your official account.</div>' +
  '</div>'
}
