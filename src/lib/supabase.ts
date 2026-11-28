/**
 * File: src/lib/supabase.ts
 * Purpose: Initializes the singleton browser Supabase client (`supabase`) using public keys
 *   and provides `invokeEdgeFunction()` for calling VARTA backend Edge Functions (`get-livekit-token`,
 *   `meeting-invitations`, `auth-email`).
 * Security: Uses only public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never stores
 *   or exposes `service_role`, email credentials, or LiveKit API secrets.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://wmmdgdwqtezzkhevcanp.supabase.co'
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_m7RDlq1de_yx03qAhWUqBQ_WASZPzbf'

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/**
 * Calls a Supabase Edge Function.
 * - Authenticated requests (`requireAuth = true`) enforce an active user JWT in `Authorization`.
 * - Guest/public requests (`requireAuth = false`) automatically attach the user's JWT ONLY if they happen
 *   to be signed in, allowing public guest access when logged out and identity verification when logged in.
 */
export async function invokeEdgeFunction<T = Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>,
  requireAuth = true
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: supabasePublishableKey,
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (requireAuth) {
    if (!session?.access_token) {
      throw new Error('Authentication required. Please log in first.')
    }
    headers.Authorization = `Bearer ${session.access_token}`
  } else if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(payload?.error || `Request failed (${res.status})`)
  }
  return payload as T
}
