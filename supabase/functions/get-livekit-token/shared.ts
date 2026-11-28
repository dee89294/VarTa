/**
 * Shared security, hashing, meeting-access verification, and LiveKit JWT/Twirp helpers
 * used by the `get-livekit-token` Edge Function.
 */
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.49.4'

export type AdminClient = SupabaseClient<any, 'public', any>

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function getSecretKey(): string {
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw)
      if (parsed?.default) return parsed.default
    } catch {
      // ignore invalid JSON
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

export function getSupabaseAdmin(): AdminClient {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', getSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Signs an official HS256 LiveKit Access Token JWT using Web Crypto API
 * (`LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET`) strictly on the server.
 */
export async function mintLiveKitToken(params: {
  apiKey: string
  apiSecret: string
  identity: string
  name: string
  roomName: string
  isOrganizer: boolean
  metadata?: Record<string, unknown>
  ttlSeconds?: number
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + (params.ttlSeconds ?? 6 * 60 * 60)

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payloadObj = {
    iss: params.apiKey,
    sub: params.identity,
    name: params.name,
    jti: params.identity,
    nbf: now - 5,
    exp,
    metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    video: {
      roomJoin: true,
      room: params.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: params.isOrganizer,
    },
  }
  const payload = base64UrlEncode(JSON.stringify(payloadObj))
  const signingInput = `${header}.${payload}`

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(params.apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

/**
 * Mints a short-lived admin JWT and calls LiveKit Cloud RoomService Twirp API
 * (e.g. `DeleteRoom` when the organizer ends a meeting, or `RemoveParticipant`).
 */
export async function callLiveKitRoomService(
  livekitUrl: string,
  apiKey: string,
  apiSecret: string,
  method: 'DeleteRoom' | 'RemoveParticipant',
  body: Record<string, unknown>
): Promise<void> {
  try {
    const httpBase = livekitUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://').replace(/\/+$/, '')
    const now = Math.floor(Date.now() / 1000)
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = base64UrlEncode(
      JSON.stringify({
        iss: apiKey,
        nbf: now - 5,
        exp: now + 120,
        video: {
          roomAdmin: true,
          roomCreate: true,
          room: String(body.room ?? ''),
        },
      })
    )
    const signingInput = `${header}.${payload}`
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(signingInput))
    const adminJwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`

    await fetch(`${httpBase}/twirp/livekit.RoomService/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.warn(`LiveKit RoomService.${method} warning:`, err instanceof Error ? err.message : err)
  }
}

export async function resolveOptionalCaller(req: Request, supabaseAdmin: AdminClient): Promise<User | null> {
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) return null
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

export interface MeetingRecord {
  id: string
  meeting_code: string
  meeting_title: string
  organizer_id: string
  meeting_status: 'scheduled' | 'active' | 'ended' | 'cancelled'
  is_instant: boolean
  waiting_room_enabled: boolean
  share_token_hash: string
  scheduled_at: string | null
  started_at: string | null
  ended_at: string | null
  organizer?: { id: string; full_name: string; email: string } | null
}

export async function findMeetingByIdentifier(
  supabaseAdmin: AdminClient,
  identifier: string
): Promise<MeetingRecord | null> {
  const clean = identifier.trim()
  if (!clean) return null

  const query = supabaseAdmin
    .from('meetings')
    .select(
      'id, meeting_code, meeting_title, organizer_id, meeting_status, is_instant, waiting_room_enabled, share_token_hash, scheduled_at, started_at, ended_at, organizer:profiles!meetings_organizer_id_fkey(id, full_name, email)'
    )

  const { data } = isUuid(clean)
    ? await query.eq('id', clean).maybeSingle()
    : await query.eq('meeting_code', clean.toLowerCase()).maybeSingle()

  return (data as unknown as MeetingRecord) ?? null
}

export interface AccessVerification {
  authorized: boolean
  isOrganizer: boolean
  participantType: 'organizer' | 'registered' | 'guest'
  matchedInvitationId?: string
  reason?: string
}

/**
 * Validates whether the caller (authenticated user or unauthenticated guest with token)
 * has permission to enter a private VarTa meeting.
 * Security rule: meeting ID/code alone is never sufficient for non-organizers without
 * a valid personal invitation token, valid meeting share token, or invited user email.
 */
export async function verifyMeetingAccess(
  supabaseAdmin: AdminClient,
  meeting: MeetingRecord,
  caller: User | null,
  rawInviteToken: string,
  rawShareToken: string
): Promise<AccessVerification> {
  if (caller && caller.id === meeting.organizer_id) {
    return {
      authorized: true,
      isOrganizer: true,
      participantType: 'organizer',
    }
  }

  // 1. Check personal invitation token (`?token=...`)
  if (rawInviteToken) {
    const tokenHash = await sha256Hex(rawInviteToken.trim())
    const { data: inv } = await supabaseAdmin
      .from('meeting_invitations')
      .select('id, invitation_status')
      .eq('meeting_id', meeting.id)
      .eq('secure_invitation_token_hash', tokenHash)
      .maybeSingle()

    if (inv && inv.invitation_status !== 'revoked') {
      return {
        authorized: true,
        isOrganizer: false,
        participantType: caller ? 'registered' : 'guest',
        matchedInvitationId: inv.id,
      }
    }
  }

  // 2. Check secure meeting share token (`?invite=...`)
  if (rawShareToken) {
    const shareHash = await sha256Hex(rawShareToken.trim())
    if (shareHash === meeting.share_token_hash) {
      return {
        authorized: true,
        isOrganizer: false,
        participantType: caller ? 'registered' : 'guest',
      }
    }
  }

  // 3. Check if authenticated user's email has an active invitation
  if (caller?.email) {
    const cleanEmail = caller.email.trim().toLowerCase()
    const { data: invByEmail } = await supabaseAdmin
      .from('meeting_invitations')
      .select('id, invitation_status')
      .eq('meeting_id', meeting.id)
      .eq('invitee_email', cleanEmail)
      .maybeSingle()

    if (invByEmail && invByEmail.invitation_status !== 'revoked') {
      return {
        authorized: true,
        isOrganizer: false,
        participantType: 'registered',
        matchedInvitationId: invByEmail.id,
      }
    }
  }

  return {
    authorized: false,
    isOrganizer: false,
    participantType: caller ? 'registered' : 'guest',
    reason: 'Access Denied: A valid invitation link or authorized email invitation is required to join this private meeting.',
  }
}
