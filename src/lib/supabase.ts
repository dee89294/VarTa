/**
 * File: src/lib/supabase.ts
 * Purpose: Initializes the singleton browser Supabase client (`supabase`) using the public publishable key
 *   and provides `invokeEdgeFunction()` for authenticated/public calls to Supabase Edge Functions.
 * Why required: Centralizes all browser-to-Supabase communication (Auth, PostgREST database queries under RLS,
 *   Realtime subscriptions, Storage uploads, and Edge Function HTTP calls) without ever exposing secret keys.
 * Connected files:
 *   - `.env.local` / `.env.example` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`)
 *   - `src/contexts/AuthContext.tsx` (uses `supabase.auth` and queries `employees` & `user_roles`)
 *   - All pages & hooks (`src/pages/*`, `src/hooks/useWebRTCMeeting.ts`, `src/components/layout/AppShell.tsx`)
 *   - Supabase Edge Functions (`employee-registration`, `admin-manage-users`, `meeting-access`)
 * Data flow: Browser sends `apikey` (publishable key) + optional user session `Authorization: Bearer <jwt>`
 *   to Supabase PostgREST, Realtime, Storage, or Edge Functions.
 * Impact if modified/removed: Breaks every database query, auth session, Realtime channel, and Edge Function call.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://wmmdgdwqtezzkhevcanp.supabase.co'
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_m7RDlq1de_yx03qAhWUqBQ_WASZPzbf'

// Singleton Supabase client configured for persistent browser auth sessions and Realtime WebSockets.
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 20,
    },
  },
})

/**
 * Calls a deployed Supabase Edge Function (`/functions/v1/<functionName>`).
 *
 * Why custom fetch instead of relying on automatic headers:
 * - Supabase's newer publishable keys (`sb_publishable_...`) must be sent in the `apikey` header,
 *   and ONLY real user session JWTs should go in `Authorization: Bearer ...` (never a publishable key).
 * - Public onboarding calls (`requireAuth = false`, e.g., `RegisterPage.tsx`) omit `Authorization`,
 *   while privileged actions (`EmployeesPage.tsx`, `LiveMeetingPage.tsx`) enforce a live user JWT.
 *
 * Connected callers:
 * - `RegisterPage.tsx` -> `employee-registration` (`requireAuth = false`)
 * - `EmployeesPage.tsx` & `TeamsPage.tsx` -> `admin-manage-users` (`requireAuth = true`)
 * - `ScheduleMeetingPage.tsx`, `MyMeetingsPage.tsx`, `LiveMeetingPage.tsx` -> `meeting-access` (`requireAuth = true`)
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

  if (requireAuth) {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) {
      throw new Error('Your session has expired. Please sign in again.')
    }
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
