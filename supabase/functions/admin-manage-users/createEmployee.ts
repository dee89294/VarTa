/**
 * Handler for `action === 'create_employee'` in `admin-manage-users`.
 */
import {
  AIPL_EMPLOYEE_ID_REGEX,
  type AdminClient,
  type OrgCategory,
  VALID_ORG_CATEGORIES,
  isFoundingCategory,
  jsonResponse,
  normalizeUrl,
  provisionAuthUserForEmployee,
  resolveDesignationTitle,
  syncSocialLinks,
  toLegacyCategory,
} from './shared.ts'
import { sendOnboardingEmail } from './email.ts'

export async function handleCreateEmployee(
  supabaseAdmin: AdminClient,
  callerId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const rawCat = String(body.org_category || body.member_category || 'employee')
  const org_category = (rawCat === 'co_founder' ? 'director' : rawCat) as OrgCategory
  const foundingMember = isFoundingCategory(org_category)
  let employee_code = String(body.employee_code ?? '').trim().toUpperCase()
  if (foundingMember && (!employee_code || !employee_code.startsWith('FOUNDER-'))) {
    employee_code = `FOUNDER-${crypto.randomUUID().slice(0, 6).toUpperCase()}`
  }

  const full_name = String(body.full_name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const phone = String(body.phone ?? '').trim()
  const department_id = (body.department_id as string | null) || null
  const team_id = (body.team_id as string | null) || null
  const designation_id = (body.designation_id as string | null) || null
  const designation = await resolveDesignationTitle(
    supabaseAdmin,
    designation_id,
    String(body.designation ?? '').trim()
  )
  const intended_role = (body.intended_role || 'employee') as 'super_admin' | 'organizer' | 'employee'
  const display_order = Math.max(
    0,
    Number.isFinite(Number(body.display_order)) ? Math.round(Number(body.display_order)) : 100
  )
  const linkedin_url = normalizeUrl(body.linkedin_url)
  const twitter_url = normalizeUrl(body.twitter_url)
  const website_url = normalizeUrl(body.website_url)
  const date_of_joining = (body.date_of_joining as string) || new Date().toISOString().slice(0, 10)
  const avatar_url = (body.avatar_url as string | null) || null
  const bio = String(body.bio ?? '').trim()
  const requestedStatus = (body.status || (body.create_account_now ? 'active' : 'invited')) as
    | 'active'
    | 'invited'
    | 'inactive'
  const password = String(body.password ?? '')
  const wantsSelfSetup = requestedStatus === 'invited' || body.create_account_now === false
  const create_account_now = requestedStatus === 'active' && !wantsSelfSetup && (foundingMember || password.length > 0 || body.create_account_now === true)

  if (!VALID_ORG_CATEGORIES.includes(org_category)) {
    return jsonResponse({ error: 'Invalid employee category selection.' }, 400)
  }
  if (!foundingMember && !AIPL_EMPLOYEE_ID_REGEX.test(employee_code)) {
    return jsonResponse({ error: 'Employee ID must follow format AIPL-(numbers), e.g. AIPL-001.' }, 400)
  }
  if (!employee_code || !full_name || !email || !designation) {
    return jsonResponse({ error: 'Full name, official email, and designation are required.' }, 400)
  }
  if (!department_id) {
    return jsonResponse({ error: 'Department selection is required.' }, 400)
  }
  if (!['super_admin', 'organizer', 'employee'].includes(intended_role)) {
    return jsonResponse({ error: 'Invalid role selection.' }, 400)
  }
  if (create_account_now && password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters when activating with an admin password.' }, 400)
  }

  const initialStatus = requestedStatus === 'inactive' ? 'inactive' : create_account_now ? 'active' : 'invited'

  const { data: insertedEmp, error: insertError } = await supabaseAdmin
    .from('employees')
    .insert({
      employee_code,
      full_name,
      email,
      phone,
      department_id,
      team_id,
      designation_id,
      designation,
      intended_role,
      org_category,
      is_founding_member: foundingMember,
      member_category: toLegacyCategory(org_category),
      display_order,
      linkedin_url,
      twitter_url,
      website_url,
      date_of_joining,
      avatar_url,
      bio,
      status: initialStatus,
      created_by: callerId,
    })
    .select('*')
    .single()

  if (insertError || !insertedEmp) {
    return jsonResponse({ error: insertError?.message ?? 'Could not create employee record.' }, 400)
  }

  await syncSocialLinks(supabaseAdmin, insertedEmp.id, { linkedin_url, twitter_url, website_url })

  if (initialStatus === 'active' && create_account_now && password.length >= 8) {
    const prov = await provisionAuthUserForEmployee(supabaseAdmin, callerId, {
      employeeId: insertedEmp.id,
      email,
      password,
      fullName: full_name,
      employeeCode: employee_code,
      intendedRole: intended_role,
      rollbackEmployeeOnAuthFailure: true,
    })

    if (prov.error) {
      return jsonResponse({ error: prov.error }, 400)
    }

    const emailRes = await sendOnboardingEmail(supabaseAdmin, {
      toEmail: email,
      fullName: full_name,
      employeeCode: employee_code,
      designation,
      intendedRole: intended_role,
      mode: 'active',
    })

    return jsonResponse({
      employee: { ...insertedEmp, auth_user_id: prov.userId },
      mode: 'active',
      email_status: emailRes.status,
      email_provider: emailRes.provider,
    })
  }

  let emailRes: { status: string; provider: string } = { status: 'skipped', provider: 'none' }
  if (initialStatus === 'invited' && !foundingMember) {
    emailRes = await sendOnboardingEmail(supabaseAdmin, {
      toEmail: email,
      fullName: full_name,
      employeeCode: employee_code,
      designation,
      intendedRole: intended_role,
      mode: 'invited',
    })
  }

  return jsonResponse({
    employee: insertedEmp,
    mode: initialStatus,
    email_status: emailRes.status,
    email_provider: emailRes.provider,
  })
}
