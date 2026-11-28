/**
 * Edge Function: meeting-invitations
 * Purpose: Authenticated organizer actions for creating meetings, generating secure
 *   share/invite tokens (stored strictly as SHA-256 hashes in Postgres), and dispatching
 *   automatic VARTA email invitations to one or multiple recipients.
 *
 * Security:
 *   - Requires a valid Supabase Auth JWT (`verify_jwt: false` with explicit `auth.getUser()` validation).
 *   - Derives stable meeting share tokens via HMAC-SHA256 using the server-only secret key,
 *     so meeting links never rely on bare meeting IDs and can be copied reliably by the organizer.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'
import { buildVartaInvitationHtml, dispatchVartaEmail, getAppUrl, getRuntimeMailConfig } from '../_shared/mailer.ts'

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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function deriveDeterministicShareToken(meetingId: string): Promise<string> {
  const keyMat = getSecretKey()
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyMat),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`varta_share:${meetingId}`))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

function generateMeetingCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const pick = (n: number) => {
    const arr = crypto.getRandomValues(new Uint8Array(n))
    return Array.from(arr, (b) => chars[b % chars.length]).join('')
  }
  return `vrt-${pick(4)}-${pick(4)}`
}

function normalizeEmailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const valid = new Set<string>()
  for (const entry of raw) {
    const clean = String(entry ?? '').trim().toLowerCase()
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      valid.add(clean)
    }
  }
  return Array.from(valid)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!token) return jsonResponse({ error: 'Authentication required. Please log in first.' }, 401)

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSecretKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
    const user = authData?.user
    if (authErr || !user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

    // Ensure profile exists cleanly for this authenticated user
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', user.id)
      .maybeSingle()

    const organizerName =
      profile?.full_name || String(user.user_metadata?.full_name || user.email?.split('@')[0] || 'Host')
    const organizerEmail = (profile?.email || user.email || '').trim().toLowerCase()

    if (!profile && organizerEmail) {
      await supabaseAdmin.from('profiles').upsert({
        id: user.id,
        full_name: organizerName,
        email: organizerEmail,
      })
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = String(body.action || 'create_meeting')
    const runtimeCfg = await getRuntimeMailConfig(supabaseAdmin)
    const appUrl = await getAppUrl(supabaseAdmin, runtimeCfg)

    const sendPersonalInvites = async (params: {
      meetingId: string
      meetingCode: string
      meetingTitle: string
      scheduledAt: string | null
      emails: string[]
    }) => {
      const results: Array<{ email: string; status: string; error?: string }> = []
      for (const recipientEmail of params.emails) {
        const rawInviteToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        const tokenHash = await sha256Hex(rawInviteToken)

        const { error: invErr } = await supabaseAdmin.from('meeting_invitations').upsert(
          {
            meeting_id: params.meetingId,
            invitee_email: recipientEmail,
            secure_invitation_token_hash: tokenHash,
            invitation_status: 'pending',
          },
          { onConflict: 'meeting_id,invitee_email' }
        )

        if (invErr) {
          results.push({ email: recipientEmail, status: 'failed', error: invErr.message })
          continue
        }

        const joinUrl = `${appUrl}/meeting/${params.meetingCode}?token=${encodeURIComponent(rawInviteToken)}`
        const html = buildVartaInvitationHtml({
          meetingTitle: params.meetingTitle,
          organizerName,
          scheduledAt: params.scheduledAt,
          joinUrl,
        })

        const dispatchRes = await dispatchVartaEmail(supabaseAdmin, {
          to: [recipientEmail],
          subject: `You are invited to a VARTA meeting — ${params.meetingTitle}`,
          html,
        })

        results.push({
          email: recipientEmail,
          status: dispatchRes.status,
          error: dispatchRes.error,
        })
      }
      return results
    }

    if (action === 'create_meeting') {
      const meetingTitle = String(body.meeting_title ?? '').trim()
      if (!meetingTitle) return jsonResponse({ error: 'Meeting title is required.' }, 400)

      const isInstant = Boolean(body.is_instant)
      const waitingRoomEnabled = Boolean(body.waiting_room_enabled)
      const scheduledAt = !isInstant && body.scheduled_at ? String(body.scheduled_at) : null
      const emails = normalizeEmailList(body.invitee_emails).filter((e) => e !== organizerEmail)

      const meetingId = crypto.randomUUID()
      const meetingCode = generateMeetingCode()
      const rawShareToken = await deriveDeterministicShareToken(meetingId)
      const shareTokenHash = await sha256Hex(rawShareToken)
      const nowIso = new Date().toISOString()

      const { data: createdMeeting, error: createErr } = await supabaseAdmin
        .from('meetings')
        .insert({
          id: meetingId,
          meeting_code: meetingCode,
          meeting_title: meetingTitle,
          organizer_id: user.id,
          meeting_status: isInstant ? 'active' : 'scheduled',
          is_instant: isInstant,
          waiting_room_enabled: waitingRoomEnabled,
          share_token_hash: shareTokenHash,
          scheduled_at: scheduledAt,
          started_at: isInstant ? nowIso : null,
        })
        .select('id, meeting_code, meeting_title, organizer_id, meeting_status, is_instant, waiting_room_enabled, scheduled_at, started_at, ended_at, created_at')
        .single()

      if (createErr || !createdMeeting) {
        return jsonResponse({ error: createErr?.message ?? 'Could not create meeting.' }, 400)
      }

      const invitationResults = emails.length
        ? await sendPersonalInvites({
            meetingId,
            meetingCode,
            meetingTitle,
            scheduledAt,
            emails,
          })
        : []

      const shareUrl = `${appUrl}/meeting/${meetingCode}?invite=${encodeURIComponent(rawShareToken)}`

      return jsonResponse({
        meeting: createdMeeting,
        share_url: shareUrl,
        invitation_results: invitationResults,
      })
    }

    if (action === 'send_invitations' || action === 'get_share_link') {
      const meetingId = String(body.meeting_id ?? '').trim()
      if (!meetingId) return jsonResponse({ error: 'meeting_id is required.' }, 400)

      const { data: meeting } = await supabaseAdmin
        .from('meetings')
        .select('id, meeting_code, meeting_title, organizer_id, meeting_status, scheduled_at, share_token_hash')
        .eq('id', meetingId)
        .maybeSingle()

      if (!meeting) return jsonResponse({ error: 'Meeting not found.' }, 404)
      if (meeting.organizer_id !== user.id) {
        return jsonResponse({ error: 'Only the meeting organizer can invite participants or copy share links.' }, 403)
      }

      const rawShareToken = await deriveDeterministicShareToken(meeting.id)
      const expectedHash = await sha256Hex(rawShareToken)
      if (meeting.share_token_hash !== expectedHash) {
        await supabaseAdmin
          .from('meetings')
          .update({ share_token_hash: expectedHash })
          .eq('id', meeting.id)
      }
      const shareUrl = `${appUrl}/meeting/${meeting.meeting_code}?invite=${encodeURIComponent(rawShareToken)}`

      if (action === 'get_share_link') {
        return jsonResponse({ share_url: shareUrl })
      }

      const emails = normalizeEmailList(body.invitee_emails).filter((e) => e !== organizerEmail)
      if (emails.length === 0) {
        return jsonResponse({ error: 'Enter at least one valid invitee email address.' }, 400)
      }

      const invitationResults = await sendPersonalInvites({
        meetingId: meeting.id,
        meetingCode: meeting.meeting_code,
        meetingTitle: meeting.meeting_title,
        scheduledAt: meeting.scheduled_at,
        emails,
      })

      return jsonResponse({
        ok: true,
        share_url: shareUrl,
        invitation_results: invitationResults,
      })
    }

    return jsonResponse({ error: 'Unsupported action.' }, 400)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error' }, 500)
  }
})
