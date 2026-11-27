/**
 * Shared helpers, constants, validation regexes, and Super Admin guard for `admin-manage-users`.
 * Connected files: `./index.ts`, `./createEmployee.ts`, `./updateEmployee.ts`, `./roleStatusActions.ts`.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4'

export type AdminClient = SupabaseClient<any, 'public', any>

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const VALID_ORG_CATEGORIES = [
  'founder',
  'managing_director',
  'director',
  'leadership',
  'department_head',
  'manager',
  'employee',
] as const

export type OrgCategory = (typeof VALID_ORG_CATEGORIES)[number]

const FOUNDING_CATEGORIES: readonly OrgCategory[] = ['founder', 'managing_director']
export const AIPL_EMPLOYEE_ID_REGEX = /^AIPL-[0-9]+$/

export function isFoundingCategory(cat: OrgCategory): boolean {
  return FOUNDING_CATEGORIES.includes(cat)
}

export function toLegacyCategory(cat: OrgCategory): 'founder' | 'director' | 'leadership' | 'employee' {
  if (cat === 'founder' || cat === 'managing_director') return 'founder'
  if (cat === 'director') return 'director'
  if (cat === 'leadership') return 'leadership'
  return 'employee'
}

export function getSecretKey(): string {
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw)
      if (parsed?.default) return parsed.default
    } catch {
      // ignore invalid JSON secret fallback
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function normalizeUrl(raw: unknown): string {
  const val = String(raw ?? '').trim()
  if (!val) return ''
  if (val.startsWith('http://') || val.startsWith('https://')) return val
  return `https://${val}`
}

export async function resolveDesignationTitle(
  supabaseAdmin: AdminClient,
  designationId: string | null,
  explicitTitle: string
): Promise<string> {
  if (!designationId || explicitTitle) return explicitTitle
  const { data } = await supabaseAdmin
    .from('designations')
    .select('title')
    .eq('id', designationId)
    .maybeSingle()
  return data?.title ?? explicitTitle
}

export async function syncSocialLinks(
  supabaseAdmin: AdminClient,
  employeeId: string,
  links: { linkedin_url: string; twitter_url: string; website_url: string }
) {
  const pairs: Array<{ platform: 'linkedin' | 'twitter' | 'website'; url: string; is_primary: boolean }> = [
    { platform: 'linkedin', url: links.linkedin_url, is_primary: true },
    { platform: 'twitter', url: links.twitter_url, is_primary: false },
    { platform: 'website', url: links.website_url, is_primary: false },
  ]
  for (const p of pairs) {
    if (p.url) {
      await supabaseAdmin.from('employee_social_links').upsert(
        { employee_id: employeeId, platform: p.platform, url: p.url, is_primary: p.is_primary },
        { onConflict: 'employee_id,platform' }
      )
    } else {
      await supabaseAdmin
        .from('employee_social_links')
        .delete()
        .eq('employee_id', employeeId)
        .eq('platform', p.platform)
    }
  }
}

export async function requireSuperAdmin(req: Request): Promise<
  | { supabaseAdmin: AdminClient; callerId: string; callerEmployeeId: string }
  | { errorResponse: Response }
> {
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    return { errorResponse: jsonResponse({ error: 'Authentication required' }, 401) }
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const {
    data: { user: caller },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token)

  if (authError || !caller) {
    return { errorResponse: jsonResponse({ error: 'Invalid or expired session' }, 401) }
  }

  const { data: callerRoleRow } = await supabaseAdmin
    .from('user_roles')
    .select('role, employee:employees!user_roles_employee_id_fkey(id, status)')
    .eq('user_id', caller.id)
    .maybeSingle()

  const callerEmployee = callerRoleRow?.employee as { id?: string; status?: string } | null
  if (!callerRoleRow || callerRoleRow.role !== 'super_admin' || callerEmployee?.status !== 'active' || !callerEmployee.id) {
    return { errorResponse: jsonResponse({ error: 'Super Admin privileges required' }, 403) }
  }

  return { supabaseAdmin, callerId: caller.id, callerEmployeeId: callerEmployee.id }
}

/**
 * Provisions a Supabase Auth account for an employee record, links `auth_user_id`,
 * marks the employee `'active'`, assigns `user_roles`, and writes a welcome notification.
 */
export async function provisionAuthUserForEmployee(
  supabaseAdmin: AdminClient,
  callerId: string,
  params: {
    employeeId: string
    email: string
    password: string
    fullName: string
    employeeCode: string
    intendedRole: 'super_admin' | 'organizer' | 'employee'
    rollbackEmployeeOnAuthFailure?: boolean
  }
): Promise<{ userId?: string; error?: string }> {
  const { data: newUser, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    app_metadata: {
      role: params.intendedRole,
      employee_id: params.employeeId,
      employee_code: params.employeeCode,
    },
    user_metadata: { full_name: params.fullName, employee_code: params.employeeCode },
  })

  if (userErr || !newUser.user) {
    if (params.rollbackEmployeeOnAuthFailure) {
      await supabaseAdmin.from('employees').delete().eq('id', params.employeeId)
    }
    return { error: userErr?.message ?? 'Failed to create Auth account.' }
  }

  const { error: linkErr } = await supabaseAdmin
    .from('employees')
    .update({
      auth_user_id: newUser.user.id,
      status: 'active',
      registered_at: new Date().toISOString(),
    })
    .eq('id', params.employeeId)

  if (linkErr) {
    await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
    if (params.rollbackEmployeeOnAuthFailure) {
      await supabaseAdmin.from('employees').delete().eq('id', params.employeeId)
    }
    return { error: linkErr.message }
  }

  const { error: roleInsertErr } = await supabaseAdmin.from('user_roles').upsert(
    {
      user_id: newUser.user.id,
      employee_id: params.employeeId,
      role: params.intendedRole,
      assigned_by: callerId,
    },
    { onConflict: 'user_id' }
  )
  if (roleInsertErr) {
    return { error: roleInsertErr.message }
  }

  await supabaseAdmin.from('notifications').insert({
    recipient_employee_id: params.employeeId,
    type: 'account_activated',
    title: 'Account Provisioned',
    message: `An administrator set up your VarTa login (${params.employeeCode}). You can sign in right away.`,
  })

  return { userId: newUser.user.id }
}
