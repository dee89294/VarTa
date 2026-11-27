/**
 * Email dispatch helpers for `admin-manage-users` (Employee ID + /register password setup invites).
 * Uses DB `platform_settings` when enabled, or Supabase Edge Function Secrets (`SMTP_*` / `RESEND_API_KEY`).
 */
import type { AdminClient } from './shared.ts'

export interface SmtpConfig {
  host: string
  port: number
  user?: string
  pass?: string
  secure?: boolean
  fromEmail: string
  fromName?: string
}

async function sendViaSmtp(
  to: string[],
  subject: string,
  html: string,
  config: SmtpConfig
): Promise<{ success: boolean; message: string }> {
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
        result += decoder.decode(buf.subarray(0, n))
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
      if (!authRes.startsWith('334')) throw new Error('AUTH LOGIN rejected: ' + authRes.trim())
      const userRes = await sendCommand(btoa(config.user))
      if (!userRes.startsWith('334')) throw new Error('SMTP user rejected: ' + userRes.trim())
      const passRes = await sendCommand(btoa(config.pass))
      if (!passRes.startsWith('235')) throw new Error('SMTP auth failed: ' + passRes.trim())
    }

    const mailFromRes = await sendCommand('MAIL FROM:<' + config.fromEmail + '>')
    if (!mailFromRes.startsWith('250')) throw new Error('MAIL FROM failed: ' + mailFromRes.trim())

    for (const recipient of to) {
      await sendCommand('RCPT TO:<' + recipient + '>')
    }

    const dataRes = await sendCommand('DATA')
    if (!dataRes.startsWith('354')) throw new Error('DATA rejected: ' + dataRes.trim())

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
    if (!transmitRes.startsWith('250')) throw new Error('Message rejected: ' + transmitRes.trim())

    await sendCommand('QUIT')
    conn.close()
    return { success: true, message: 'Delivered via SMTP' }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'SMTP delivery failed'
    return { success: false, message: msg }
  }
}

export async function dispatchSystemEmail(
  supabaseAdmin: AdminClient,
  params: { to: string[]; subject: string; html: string }
): Promise<{ status: 'sent' | 'skipped' | 'not_configured'; provider: string }> {
  if (!params.to || params.to.length === 0) return { status: 'skipped', provider: 'none' }

  let dbFromEmail = ''
  let dbFromName = ''
  try {
    const { data: settings } = await supabaseAdmin
      .from('platform_settings')
      .select('smtp_enabled, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from_email, smtp_from_name')
      .eq('id', 1)
      .maybeSingle()

    const useDbSmtp = Boolean(settings?.smtp_enabled && settings?.smtp_host)
    const host = useDbSmtp && settings?.smtp_host ? String(settings.smtp_host) : (Deno.env.get('SMTP_HOST') || '')
    const user = useDbSmtp ? (settings?.smtp_user || undefined) : (Deno.env.get('SMTP_USER') || undefined)
    const pass = useDbSmtp ? (settings?.smtp_pass || undefined) : (Deno.env.get('SMTP_PASS') || undefined)
    const port = Number((useDbSmtp ? settings?.smtp_port : Deno.env.get('SMTP_PORT')) || 587)
    const secure = useDbSmtp
      ? Boolean(settings?.smtp_secure ?? (port === 465))
      : Deno.env.get('SMTP_SECURE') === 'true' || port === 465

    dbFromEmail = String(settings?.smtp_from_email || '')
    dbFromName = String(settings?.smtp_from_name || '')
    const fromEmail = dbFromEmail || Deno.env.get('VARTA_INVITE_FROM_EMAIL') || 'invites@varta.io'
    const fromName = dbFromName || Deno.env.get('SMTP_FROM_NAME') || 'VarTa Meetings'

    if (host) {
      const smtpRes = await sendViaSmtp(params.to, params.subject, params.html, {
        host,
        port,
        user,
        pass,
        secure,
        fromEmail,
        fromName,
      })
      if (smtpRes.success) {
        return { status: 'sent', provider: 'smtp' }
      }
      console.warn('SMTP error:', smtpRes.message)
    }
  } catch (e: unknown) {
    console.warn('Settings SMTP error:', e instanceof Error ? e.message : e)
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    try {
      const resendFrom =
        Deno.env.get('VARTA_INVITE_FROM_EMAIL') ||
        (dbFromEmail ? (dbFromName ? `${dbFromName} <${dbFromEmail}>` : dbFromEmail) : 'VarTa Meetings <invites@varta.io>')
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + resendKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: resendFrom,
          to: params.to,
          subject: params.subject,
          html: params.html,
        }),
      })
      if (res.ok) {
        return { status: 'sent', provider: 'resend' }
      }
    } catch (e: unknown) {
      console.warn('Resend error:', e instanceof Error ? e.message : e)
    }
  }

  return { status: 'not_configured', provider: 'none' }
}

export async function sendOnboardingEmail(
  supabaseAdmin: AdminClient,
  params: {
    toEmail: string
    fullName: string
    employeeCode: string
    designation: string
    intendedRole: string
    mode: 'invited' | 'active'
  }
) {
  const appUrl = (Deno.env.get('APP_URL') || 'http://localhost:5173').replace(/\/+$/, '')
  const actionUrl = params.mode === 'invited' ? `${appUrl}/register` : `${appUrl}/login`
  const roleLabel = params.intendedRole.replace('_', ' ').toUpperCase()

  const isInvite = params.mode === 'invited'
  const subject = isInvite
    ? `Welcome to VarTa — Your Employee ID (${params.employeeCode}) & Password Setup`
    : `Your VarTa Account is Active (${params.employeeCode})`

  const ctaLabel = isInvite ? 'Verify ID & Set Password' : 'Sign In to Workspace'
  const introText = isInvite
    ? `Your employee profile has been added to <strong>VarTa</strong>. Use the Employee ID and official email below to authenticate and set or generate your password.`
    : `Your employee account (<strong>${params.employeeCode}</strong>) is now active on <strong>VarTa</strong>. Use your official email and the initial password provided by your administrator to sign in.`

  const html = [
    '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #E5E8F2; border-radius: 20px;">',
    '  <div style="margin-bottom: 18px;">',
    '    <span style="display: inline-block; background: #EFF1F8; color: #4D4CEF; border: 1px solid #DFE3F2; font-family: monospace; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px;">' + params.employeeCode + '</span>',
    '    <h2 style="color: #151722; font-size: 22px; font-weight: 700; margin: 12px 0 6px 0;">Hello ' + params.fullName + ',</h2>',
    '    <p style="color: #454A62; font-size: 14px; line-height: 1.6; margin: 0;">' + introText + '</p>',
    '  </div>',
    '  <div style="background: #F8F9FD; border: 1px solid #E9ECF6; border-radius: 14px; padding: 16px; margin: 20px 0; font-size: 13px; color: #373A4D;">',
    '    <div style="margin-bottom: 6px;"><strong>Employee ID:</strong> <code>' + params.employeeCode + '</code></div>',
    '    <div style="margin-bottom: 6px;"><strong>Official Email:</strong> ' + params.toEmail + '</div>',
    '    <div style="margin-bottom: 6px;"><strong>Designation:</strong> ' + params.designation + '</div>',
    '    <div><strong>Access Role:</strong> ' + roleLabel + '</div>',
    '  </div>',
    '  <div style="text-align: center; margin: 24px 0;">',
    '    <a href="' + actionUrl + '" style="display: inline-block; background: #4D4CEF; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 999px;">' + ctaLabel + '</a>',
    '    <div style="margin-top: 8px; font-size: 11px; color: #8D92A8;">Direct Link: <a href="' + actionUrl + '" style="color: #4D4CEF;">' + actionUrl + '</a></div>',
    '  </div>',
    '  <div style="border-top: 1px solid #EEF0F7; padding-top: 12px; font-size: 11px; color: #8D92A8;">',
    '    VarTa Enterprise Workspace • Automated Onboarding Notification',
    '  </div>',
    '</div>',
  ].join('\n')

  return await dispatchSystemEmail(supabaseAdmin, {
    to: [params.toEmail],
    subject,
    html,
  })
}
