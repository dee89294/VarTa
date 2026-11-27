/**
 * Handler for `action === 'update_employee'` in `admin-manage-users`.
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

export async function handleUpdateEmployee(
  supabaseAdmin: AdminClient,
  callerId: string,
  callerEmployeeId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const employee_id = String(body.employee_id ?? '')
  if (!employee_id) return jsonResponse({ error: 'employee_id is required' }, 400)

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', employee_id)
    .single()

  if (fetchErr || !existing) return jsonResponse({ error: 'Employee not found' }, 404)

  const rawNextCat = String(body.org_category || body.member_category || existing.org_category || 'employee')
  const nextOrgCat = (rawNextCat === 'co_founder' ? 'director' : rawNextCat) as OrgCategory
  const nextFounding = isFoundingCategory(nextOrgCat)

  if (!VALID_ORG_CATEGORIES.includes(nextOrgCat)) {
    return jsonResponse({ error: 'Invalid employee category selection.' }, 400)
  }

  let nextCode = body.employee_code ? String(body.employee_code).trim().toUpperCase() : existing.employee_code
  if (nextFounding) {
    if (!nextCode || !nextCode.startsWith('FOUNDER-')) {
      nextCode = `FOUNDER-${existing.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`
    }
  } else if (!AIPL_EMPLOYEE_ID_REGEX.test(nextCode)) {
    return jsonResponse({ error: 'Employee ID must follow format AIPL-(numbers), e.g. AIPL-001.' }, 400)
  }

  const nextEmail = body.email ? String(body.email).trim().toLowerCase() : existing.email
  const nextName = body.full_name ? String(body.full_name).trim() : existing.full_name
  const nextRole = (body.intended_role ?? existing.intended_role) as 'super_admin' | 'organizer' | 'employee'
  if (existing.id === callerEmployeeId && nextRole !== 'super_admin') {
    return jsonResponse({ error: 'You cannot demote your own active Super Admin account.' }, 400)
  }

  const nextStatus = (body.status ?? existing.status) as 'active' | 'invited' | 'inactive'
  if (existing.id === callerEmployeeId && nextStatus === 'inactive') {
    return jsonResponse({ error: 'You cannot deactivate your own active Super Admin account.' }, 400)
  }

  const nextDesignationId =
    body.designation_id !== undefined ? ((body.designation_id as string | null) || null) : existing.designation_id
  const nextDesignation = body.designation
    ? String(body.designation).trim()
    : await resolveDesignationTitle(supabaseAdmin, nextDesignationId, existing.designation)

  const nextOrder =
    body.display_order !== undefined && Number.isFinite(Number(body.display_order))
      ? Math.max(0, Math.round(Number(body.display_order)))
      : existing.display_order

  const nextLinkedin = body.linkedin_url !== undefined ? normalizeUrl(body.linkedin_url) : existing.linkedin_url
  const nextTwitter = body.twitter_url !== undefined ? normalizeUrl(body.twitter_url) : existing.twitter_url
  const nextWebsite = body.website_url !== undefined ? normalizeUrl(body.website_url) : existing.website_url
  const rawPassword = typeof body.password === 'string' ? body.password : ''

  if (rawPassword && rawPassword.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters long.' }, 400)
  }

  const willActivateNow = !existing.auth_user_id && rawPassword.length >= 8 && nextStatus !== 'inactive'
  const effectiveStatus = !existing.auth_user_id && nextStatus === 'active' && !willActivateNow ? 'invited' : nextStatus

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('employees')
    .update({
      employee_code: nextCode,
      full_name: nextName,
      email: nextEmail,
      phone: body.phone !== undefined ? String(body.phone).trim() : existing.phone,
      department_id: body.department_id !== undefined ? ((body.department_id as string | null) || null) : existing.department_id,
      team_id: body.team_id !== undefined ? ((body.team_id as string | null) || null) : existing.team_id,
      designation_id: nextDesignationId,
      designation: nextDesignation,
      date_of_joining: (body.date_of_joining as string) || existing.date_of_joining,
      avatar_url: body.avatar_url !== undefined ? body.avatar_url : existing.avatar_url,
      bio: body.bio !== undefined ? String(body.bio).trim() : existing.bio,
      intended_role: nextRole,
      org_category: nextOrgCat,
      is_founding_member: nextFounding,
      member_category: toLegacyCategory(nextOrgCat),
      display_order: nextOrder,
      linkedin_url: nextLinkedin,
      twitter_url: nextTwitter,
      website_url: nextWebsite,
      status: effectiveStatus,
    })
    .eq('id', employee_id)
    .select('*')
    .single()

  if (updateErr) return jsonResponse({ error: updateErr.message }, 400)

  await syncSocialLinks(supabaseAdmin, employee_id, {
    linkedin_url: nextLinkedin ?? '',
    twitter_url: nextTwitter ?? '',
    website_url: nextWebsite ?? '',
  })

  if (existing.auth_user_id) {
    const authPayload: Record<string, unknown> = {
      email: nextEmail,
      email_confirm: true,
      ban_duration: effectiveStatus === 'inactive' ? '876000h' : 'none',
      app_metadata: {
        role: nextRole,
        employee_id,
        employee_code: nextCode,
      },
      user_metadata: {
        full_name: nextName,
        employee_code: nextCode,
      },
    }
    if (rawPassword.length >= 8) {
      authPayload.password = rawPassword
    }
    const { error: authUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(existing.auth_user_id, authPayload)
    if (authUpdateErr) {
      await supabaseAdmin
        .from('employees')
        .update({
          email: existing.email,
          full_name: existing.full_name,
          employee_code: existing.employee_code,
          intended_role: existing.intended_role,
          status: existing.status,
        })
        .eq('id', employee_id)
      return jsonResponse({ error: authUpdateErr.message }, 400)
    }

    const { error: roleUpsertErr } = await supabaseAdmin.from('user_roles').upsert(
      {
        user_id: existing.auth_user_id,
        employee_id,
        role: nextRole,
        assigned_by: callerId,
      },
      { onConflict: 'user_id' }
    )
    if (roleUpsertErr) return jsonResponse({ error: roleUpsertErr.message }, 400)
  } else if (willActivateNow) {
    const prov = await provisionAuthUserForEmployee(supabaseAdmin, callerId, {
      employeeId: employee_id,
      email: nextEmail,
      password: rawPassword,
      fullName: nextName,
      employeeCode: nextCode,
      intendedRole: nextRole,
      rollbackEmployeeOnAuthFailure: false,
    })
    if (prov.error) return jsonResponse({ error: prov.error }, 400)
  }

  return jsonResponse({ employee: updated })
}
