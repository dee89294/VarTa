/**
 * Password reset request handler for `employee-registration`.
 * Uses Supabase Auth `admin.generateLink({ type: 'recovery' })` and dispatches the reset
 * link + OTP code via DB `platform_settings`, Edge Secrets, Supabase Vault, or Resend.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4'

type AdminClient = SupabaseClient<any, 'public', any>

interface RuntimeMailConfig {
  app_url?: string
  host?: string
  port?: number
  user?: string
  pass?: string
  secure?: boolean
  from_email?: string
  from_name?: string
}

async function getRuntimeMailConfig(supabaseAdmin: AdminClient): Promise<RuntimeMailConfig> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_smtp_runtime_config')
    if (!error && data && typeof data === 'object') {
      return data as RuntimeMailConfig
    }
  } catch {
    // ignore RPC fallback errors
  }
  return {}
}

async function sendViaSmtp(
  to: string[],
  subject: string,
  html: string,
  config: {
    host: string
    port: number
    user?: string
    pass?: string
    secure?: boolean
    fromEmail: string
    fromName?: string
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const host = config.host.trim()
    const port = config.port || (config.secure ? 465 : 587)
    const user = config.user?.trim()
    const rawPass = config.pass
    const pass = rawPass && host.toLowerCase().includes('gmail') ? rawPass.replace(/\s+/g, '') : rawPass
    const fromEmail = config.fromEmail.trim()

    let conn: Deno.Conn = config.secure
      ? await Deno.connectTls({ hostname: host, port })
      : await Deno.connect({ hostname: host, port })

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
    if (!greeting.startsWith('220')) throw new Error('SMTP greeting failed: ' + greeting.trim())

    let ehloRes = await sendCommand('EHLO varta.io')
    if (!config.secure && (ehloRes.includes('STARTTLS') || port === 587)) {
      const tlsRes = await sendCommand('STARTTLS')
      if (tlsRes.startsWith('220')) {
        conn = await Deno.startTls(conn, { hostname: host })
        ehloRes = await sendCommand('EHLO varta.io')
      }
    }

    if (user && pass) {
      const authRes = await sendCommand('AUTH LOGIN')
      if (!authRes.startsWith('334')) throw new Error('AUTH LOGIN rejected: ' + authRes.trim())
      const userRes = await sendCommand(btoa(user))
      if (!userRes.startsWith('334')) throw new Error('SMTP user rejected: ' + userRes.trim())
      const passRes = await sendCommand(btoa(pass))
      if (!passRes.startsWith('235')) throw new Error('SMTP auth failed: ' + passRes.trim())
    }

    const mailFromRes = await sendCommand('MAIL FROM:<' + fromEmail + '>')
    if (!mailFromRes.startsWith('250')) throw new Error('MAIL FROM failed: ' + mailFromRes.trim())

    for (const recipient of to) {
      await sendCommand('RCPT TO:<' + recipient + '>')
    }

    const dataRes = await sendCommand('DATA')
    if (!dataRes.startsWith('354')) throw new Error('DATA rejected: ' + dataRes.trim())

    const fromHeader = config.fromName ? '"' + config.fromName + '" <' + fromEmail + '>' : fromEmail
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
    return { success: false, message: err instanceof Error ? err.message : 'SMTP delivery failed' }
  }
}

async function dispatchMail(
  supabaseAdmin: AdminClient,
  runtimeCfg: RuntimeMailConfig,
  params: { to: string[]; subject: string; html: string }
): Promise<{ status: 'sent' | 'not_configured'; provider: string }> {
  let dbFromEmail = ''
  let dbFromName = ''
  try {
    const { data: settings } = await supabaseAdmin
      .from('platform_settings')
      .select('smtp_enabled, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, smtp_from_email, smtp_from_name')
      .eq('id', 1)
      .maybeSingle()

    const useDbSmtp = Boolean(settings?.smtp_enabled && settings?.smtp_host)
    const envHost = Deno.env.get('SMTP_HOST') || ''

    const host = useDbSmtp && settings?.smtp_host
      ? String(settings.smtp_host)
      : envHost || String(runtimeCfg.host || '')
    const user = useDbSmtp
      ? (settings?.smtp_user || undefined)
      : envHost
        ? (Deno.env.get('SMTP_USER') || undefined)
        : (runtimeCfg.user || undefined)
    const pass = useDbSmtp
      ? (settings?.smtp_pass || undefined)
      : envHost
        ? (Deno.env.get('SMTP_PASS') || undefined)
        : (runtimeCfg.pass || undefined)
    const port = Number(
      (useDbSmtp ? settings?.smtp_port : envHost ? Deno.env.get('SMTP_PORT') : runtimeCfg.port) || 587
    )
    const secure = useDbSmtp
      ? Boolean(settings?.smtp_secure ?? (port === 465))
      : envHost
        ? Deno.env.get('SMTP_SECURE') === 'true' || port === 465
        : Boolean(runtimeCfg.secure ?? (port === 465))

    dbFromEmail = String(settings?.smtp_from_email || '')
    dbFromName = String(settings?.smtp_from_name || '')
    const envFromEmail = Deno.env.get('VARTA_INVITE_FROM_EMAIL') || ''
    const envFromName = Deno.env.get('SMTP_FROM_NAME') || ''
    const fromEmail = useDbSmtp
      ? dbFromEmail || user || envFromEmail || 'invites@varta.io'
      : envFromEmail || String(runtimeCfg.from_email || '') || user || dbFromEmail || 'invites@varta.io'
    const fromName = useDbSmtp
      ? dbFromName || envFromName || 'VarTa Meetings'
      : envFromName || String(runtimeCfg.from_name || '') || dbFromName || 'VarTa Meetings'

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
      console.warn('Reset password SMTP error:', smtpRes.message)
    }
  } catch (e: unknown) {
    console.warn('Reset password settings error:', e instanceof Error ? e.message : e)
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
      if (res.ok) return { status: 'sent', provider: 'resend' }
    } catch (e: unknown) {
      console.warn('Reset password Resend error:', e instanceof Error ? e.message : e)
    }
  }

  return { status: 'not_configured', provider: 'none' }
}

export async function handleRequestPasswordReset(
  supabaseAdmin: AdminClient,
  rawEmail: string,
  jsonResponse: (body: unknown, status?: number) => Response
): Promise<Response> {
  if (!rawEmail || !rawEmail.includes('@')) {
    return jsonResponse({ error: 'Please enter a valid company email address.' }, 400)
  }

  const genericMessage =
    'If an active VarTa workspace account exists for that email address, password reset instructions have been sent.'

  const { data: employee, error: lookupError } = await supabaseAdmin
    .from('employees')
    .select('id, auth_user_id, employee_code, full_name, email, status, is_founding_member')
    .eq('email', rawEmail)
    .maybeSingle()

  if (lookupError) {
    return jsonResponse({ error: lookupError.message }, 500)
  }

  if (!employee || employee.status === 'inactive') {
    return jsonResponse({ ok: true, message: genericMessage })
  }

  const runtimeCfg = await getRuntimeMailConfig(supabaseAdmin)
  const appUrl = (Deno.env.get('APP_URL') || runtimeCfg.app_url || 'http://localhost:5173').replace(/\/+$/, '')

  if (!employee.auth_user_id || employee.status === 'invited') {
    const setupUrl = employee.is_founding_member ? `${appUrl}/login` : `${appUrl}/register`
    const inviteHtml = [
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #E5E8F2; border-radius: 20px;">',
      '  <span style="display: inline-block; background: #EFF1F8; color: #4D4CEF; border: 1px solid #DFE3F2; font-family: monospace; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px;">' + employee.employee_code + '</span>',
      '  <h2 style="color: #151722; font-size: 22px; font-weight: 700; margin: 12px 0 8px 0;">Activate Your VarTa Password</h2>',
      '  <p style="color: #454A62; font-size: 14px; line-height: 1.6;">Hello <strong>' + employee.full_name + '</strong>, your employee record has not set up an initial password yet. Use your Employee ID (<code>' + employee.employee_code + '</code>) and email to set your password.</p>',
      '  <div style="text-align: center; margin: 24px 0;">',
      '    <a href="' + setupUrl + '" style="display: inline-block; background: #4D4CEF; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 999px;">Verify ID & Set Password</a>',
      '    <div style="margin-top: 8px; font-size: 11px; color: #8D92A8;">Direct Link: <a href="' + setupUrl + '" style="color: #4D4CEF;">' + setupUrl + '</a></div>',
      '  </div>',
      '</div>',
    ].join('\n')

    await dispatchMail(supabaseAdmin, runtimeCfg, {
      to: [employee.email],
      subject: `Set Up Your VarTa Password (${employee.employee_code})`,
      html: inviteHtml,
    })

    return jsonResponse({ ok: true, message: genericMessage })
  }

  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: rawEmail,
    options: { redirectTo: `${appUrl}/reset-password` },
  })

  if (linkErr || !linkData?.properties) {
    return jsonResponse({ error: linkErr?.message ?? 'Could not generate password reset link.' }, 500)
  }

  const tokenHash = linkData.properties.hashed_token
  const emailOtp = linkData.properties.email_otp
  const resetUrl = tokenHash
    ? `${appUrl}/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
    : linkData.properties.action_link

  const html = [
    '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #E5E8F2; border-radius: 20px;">',
    '  <div style="margin-bottom: 18px;">',
    '    <span style="display: inline-block; background: #EFF1F8; color: #4D4CEF; border: 1px solid #DFE3F2; font-family: monospace; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 999px;">' + employee.employee_code + '</span>',
    '    <h2 style="color: #151722; font-size: 22px; font-weight: 700; margin: 12px 0 6px 0;">Password Reset Request</h2>',
    '    <p style="color: #454A62; font-size: 14px; line-height: 1.6; margin: 0;">Hello <strong>' + employee.full_name + '</strong>, we received a request to reset your VarTa workspace password. Click the button below or enter the verification code on the Reset Password page.</p>',
    '  </div>',
    emailOtp
      ? '  <div style="background: #F8F9FD; border: 1px solid #E9ECF6; border-radius: 14px; padding: 14px 16px; margin: 18px 0; text-align: center;">' +
        '    <div style="font-size: 11px; font-weight: 600; color: #6E748C; text-transform: uppercase; letter-spacing: 0.08em;">One-Time Recovery Code</div>' +
        '    <div style="font-family: monospace; font-size: 24px; font-weight: 800; letter-spacing: 0.25em; color: #151722; margin-top: 4px;">' + emailOtp + '</div>' +
        '  </div>'
      : '',
    '  <div style="text-align: center; margin: 24px 0;">',
    '    <a href="' + resetUrl + '" style="display: inline-block; background: #4D4CEF; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 999px;">Reset Password</a>',
    '    <div style="margin-top: 10px; font-size: 11px; color: #8D92A8; word-break: break-all;">Direct Link: <a href="' + resetUrl + '" style="color: #4D4CEF;">' + resetUrl + '</a></div>',
    '  </div>',
    '  <div style="border-top: 1px solid #EEF0F7; padding-top: 12px; font-size: 11px; color: #8D92A8;">',
    '    If you did not request a password reset, you can safely ignore this email. • VarTa Enterprise Workspace',
    '  </div>',
    '</div>',
  ].join('\n')

  const mailRes = await dispatchMail(supabaseAdmin, runtimeCfg, {
    to: [employee.email],
    subject: 'Reset Your VarTa Workspace Password',
    html,
  })

  if (mailRes.status !== 'sent') {
    return jsonResponse(
      { error: 'Unable to send reset email right now. Please contact your Super Admin to check SMTP settings.' },
      502
    )
  }

  return jsonResponse({ ok: true, message: genericMessage })
}
