/**
 * Edge Function: auth-email
 * Purpose: Handles password reset requests for registered VarTa users (`public.profiles`)
 *   using Supabase Auth `admin.generateLink({ type: 'recovery' })` and the existing Gmail SMTP
 *   / Vault / Resend delivery pipeline.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'
import { dispatchVartaEmail, getAppUrl, getRuntimeMailConfig } from '../_shared/mailer.ts'

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const rawEmail = String(body.email ?? '').trim().toLowerCase()

    if (!rawEmail || !rawEmail.includes('@')) {
      return jsonResponse({ error: 'Please enter a valid email address.' }, 400)
    }

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSecretKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email')
      .eq('email', rawEmail)
      .maybeSingle()

    if (profErr) return jsonResponse({ error: profErr.message }, 500)
    if (!profile) {
      return jsonResponse({ error: 'No registered VARTA account exists for this email address.' }, 404)
    }

    const runtimeCfg = await getRuntimeMailConfig(supabaseAdmin)
    const appUrl = await getAppUrl(supabaseAdmin, runtimeCfg)

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
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 28px; background: #ffffff; border: 1px solid #E5E8F2; border-radius: 20px;">',
      '  <div style="display: inline-block; padding: 6px 14px; border-radius: 999px; background: #EFF1F8; color: #4D4CEF; font-size: 12px; font-weight: 700; margin-bottom: 14px;">VARTA Password Recovery</div>',
      '  <h2 style="color: #151722; font-size: 22px; font-weight: 700; margin: 0 0 8px 0;">Reset Your Password</h2>',
      '  <p style="color: #454A62; font-size: 14px; line-height: 1.6; margin: 0 0 18px 0;">Hello <strong>' + profile.full_name + '</strong>, click the button below or use the one-time code to reset your VARTA account password.</p>',
      emailOtp
        ? '  <div style="background: #F8F9FD; border: 1px solid #E9ECF6; border-radius: 14px; padding: 14px 16px; margin: 18px 0; text-align: center;">' +
          '    <div style="font-size: 11px; font-weight: 600; color: #6E748C; text-transform: uppercase; letter-spacing: 0.08em;">Recovery Code</div>' +
          '    <div style="font-family: monospace; font-size: 24px; font-weight: 800; letter-spacing: 0.25em; color: #151722; margin-top: 4px;">' + emailOtp + '</div>' +
          '  </div>'
        : '',
      '  <div style="text-align: center; margin: 24px 0;">',
      '    <a href="' + resetUrl + '" style="display: inline-block; background: #4D4CEF; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 999px;">Reset Password</a>',
      '    <div style="margin-top: 10px; font-size: 11px; color: #8D92A8; word-break: break-all;">Direct Link: <a href="' + resetUrl + '" style="color: #4D4CEF;">' + resetUrl + '</a></div>',
      '  </div>',
      '</div>',
    ].join('\n')

    const mailRes = await dispatchVartaEmail(supabaseAdmin, {
      to: [profile.email],
      subject: 'Reset Your VARTA Account Password',
      html,
    })

    if (mailRes.status !== 'sent') {
      return jsonResponse({ error: mailRes.error || 'Could not dispatch reset email.' }, 502)
    }

    return jsonResponse({
      ok: true,
      message: 'A password reset link and one-time recovery code have been sent to your email.',
    })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error' }, 500)
  }
})
