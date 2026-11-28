/**
 * Shared SMTP / Resend / Supabase Vault mail dispatch helper for VarTa Edge Functions.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4'

export type AdminClient = SupabaseClient<any, 'public', any>

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

export async function getRuntimeMailConfig(supabaseAdmin: AdminClient): Promise<RuntimeMailConfig> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_smtp_runtime_config')
    if (!error && data && typeof data === 'object') {
      return data as RuntimeMailConfig
    }
  } catch {
    // ignore RPC errors
  }
  return {}
}

export async function getAppUrl(supabaseAdmin: AdminClient, runtimeCfg?: RuntimeMailConfig): Promise<string> {
  const envAppUrl = Deno.env.get('APP_URL')
  if (envAppUrl) return envAppUrl.replace(/\/+$/, '')
  const cfg = runtimeCfg ?? (await getRuntimeMailConfig(supabaseAdmin))
  return (cfg.app_url || 'https://varta-phi.vercel.app').replace(/\/+$/, '')
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

    const fromHeader = config.fromName ? `"${config.fromName}" <${fromEmail}>` : fromEmail
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

export async function dispatchVartaEmail(
  supabaseAdmin: AdminClient,
  params: { to: string[]; subject: string; html: string }
): Promise<{ status: 'sent' | 'not_configured' | 'failed'; provider: string; error?: string }> {
  if (!params.to.length) return { status: 'not_configured', provider: 'none' }

  const runtimeCfg = await getRuntimeMailConfig(supabaseAdmin)
  const envHost = Deno.env.get('SMTP_HOST') || ''
  const host = envHost || String(runtimeCfg.host || '')
  const user = envHost ? (Deno.env.get('SMTP_USER') || undefined) : (runtimeCfg.user || undefined)
  const pass = envHost ? (Deno.env.get('SMTP_PASS') || undefined) : (runtimeCfg.pass || undefined)
  const port = Number((envHost ? Deno.env.get('SMTP_PORT') : runtimeCfg.port) || 587)
  const secure = envHost ? Deno.env.get('SMTP_SECURE') === 'true' || port === 465 : Boolean(runtimeCfg.secure ?? (port === 465))
  const fromEmail = Deno.env.get('VARTA_INVITE_FROM_EMAIL') || String(runtimeCfg.from_email || '') || user || 'invites@varta.io'
  const fromName = Deno.env.get('SMTP_FROM_NAME') || String(runtimeCfg.from_name || '') || 'VarTa Meetings'

  let lastErr = ''
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
    lastErr = smtpRes.message
    console.warn('SMTP error:', smtpRes.message)
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    try {
      const resendFrom = `${fromName} <${fromEmail}>`
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
      lastErr = `Resend HTTP ${res.status}`
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : 'Resend delivery failed'
    }
  }

  return {
    status: host || resendKey ? 'failed' : 'not_configured',
    provider: host ? 'smtp' : resendKey ? 'resend' : 'none',
    error: lastErr || undefined,
  }
}

export function buildVartaInvitationHtml(params: {
  meetingTitle: string
  organizerName: string
  scheduledAt: string | null
  joinUrl: string
}): string {
  const scheduleRow = params.scheduledAt
    ? `<div style="margin-top: 8px; color: #454A62; font-size: 13px;"><strong>Scheduled:</strong> ${new Date(params.scheduledAt).toUTCString()}</div>`
    : `<div style="margin-top: 8px; color: #059669; font-size: 13px; font-weight: 600;">Instant Meeting — Live Now</div>`

  return [
    '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #E5E8F2; border-radius: 20px;">',
    '  <div style="display: inline-block; padding: 6px 14px; border-radius: 999px; background: #EFF1F8; color: #4D4CEF; font-size: 12px; font-weight: 700; margin-bottom: 14px;">VARTA Meeting Invitation</div>',
    '  <h2 style="color: #151722; font-size: 22px; font-weight: 700; margin: 0 0 8px 0;">You are invited to a VARTA meeting</h2>',
    '  <p style="color: #454A62; font-size: 14px; line-height: 1.6; margin: 0 0 18px 0;">Hello,<br/><br/><strong>' + params.organizerName + '</strong> has invited you to join <strong>' + params.meetingTitle + '</strong> on VARTA.</p>',
    '  <div style="background: #F8F9FD; border: 1px solid #E9ECF6; border-radius: 14px; padding: 16px; margin-bottom: 22px;">',
    '    <div style="color: #151722; font-size: 14px; font-weight: 700;">' + params.meetingTitle + '</div>',
    '    <div style="color: #6E748C; font-size: 13px; margin-top: 4px;">Host: ' + params.organizerName + '</div>',
    '    ' + scheduleRow,
    '  </div>',
    '  <div style="text-align: center; margin: 24px 0;">',
    '    <a href="' + params.joinUrl + '" style="display: inline-block; background: #4D4CEF; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 13px 30px; border-radius: 999px;">Join Meeting</a>',
    '    <div style="margin-top: 10px; font-size: 11px; color: #8D92A8; word-break: break-all;">Or copy link: <a href="' + params.joinUrl + '" style="color: #4D4CEF;">' + params.joinUrl + '</a></div>',
    '  </div>',
    '  <p style="color: #6E748C; font-size: 12px; line-height: 1.5; margin: 18px 0 0 0;">You can join as a guest without creating an account, or log in using your existing VARTA account.</p>',
    '  <div style="border-top: 1px solid #EEF0F7; margin-top: 18px; padding-top: 12px; font-size: 11px; color: #8D92A8;">Regards,<br/>VARTA Meeting Platform</div>',
    '</div>',
  ].join('\n')
}
