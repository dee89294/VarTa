/**
 * Edge Function: employee-registration
 * Purpose: Server-side employee onboarding verification and Auth credential creation.
 * Why required: Prevents arbitrary signups with random Employee IDs or unauthorized emails by ensuring
 *   the secret/service-role key (never exposed to browser code) verifies against Super Admin-created
 *   `public.employees` records before creating a Supabase Auth account.
 * Called by: `src/pages/RegisterPage.tsx` (`invokeEdgeFunction('employee-registration', ..., false)`)
 * Parameters: `{ action: 'verify' | 'register', employee_code, email, password?, phone? }`
 * Tables accessed: `employees` (joined with `departments`, `teams`), `user_roles`, `notifications`, `auth.users`
 * Authentication & Authorization:
 *   - Public endpoint (`verify_jwt: false` because registering employees are not signed in yet).
 *   - Strictly validates `employee_code` + `email` match, `status !== 'inactive'`, and `auth_user_id IS NULL`.
 * Returns:
 *   - `verify`: `{ verified: true, employee: { id, employee_code, full_name, email, designation, intended_role, department_name, team_name } }`
 *   - `register`: `{ success: true, email, role }`
 * Connected dependents: `RegisterPage.tsx` uses the response to sign the user in and hydrate `AuthContext.tsx`.
 * Impact if modified/removed: Self-service employee onboarding breaks or loses server-side HR record verification.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'
import { handleRequestPasswordReset } from './passwordReset.ts'

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const action = body?.action as string
    const rawCode = typeof body?.employee_code === 'string' ? body.employee_code.trim().toUpperCase() : ''
    const rawEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : undefined

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', getSecretKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    if (action === 'request_password_reset') {
      return await handleRequestPasswordReset(supabaseAdmin, rawEmail, jsonResponse)
    }

    if (!rawCode || !rawEmail) {
      return jsonResponse({ error: 'Employee ID and company email address are required.' }, 400)
    }
    if (!/^AIPL-[0-9]+$/.test(rawCode)) {
      return jsonResponse({ error: 'Employee ID must use format AIPL-(numbers), e.g. AIPL-001.' }, 400)
    }

    const { data: employee, error: lookupError } = await supabaseAdmin
      .from('employees')
      .select(`
        id,
        auth_user_id,
        employee_code,
        full_name,
        email,
        designation,
        status,
        intended_role,
        is_founding_member,
        department:departments!employees_department_id_fkey(name),
        team:teams!employees_team_id_fkey(name)
      `)
      .eq('employee_code', rawCode)
      .eq('email', rawEmail)
      .maybeSingle()

    if (lookupError) {
      return jsonResponse({ error: lookupError.message }, 500)
    }

    if (!employee || employee.is_founding_member) {
      return jsonResponse(
        {
          error:
            'Verification failed. No authorized employee invitation matches that Employee ID and company email.',
        },
        404
      )
    }

    if (employee.status === 'inactive') {
      return jsonResponse(
        { error: 'This employee record has been deactivated. Contact your Super Admin.' },
        403
      )
    }

    if (employee.auth_user_id || employee.status === 'active') {
      return jsonResponse(
        { error: 'This employee account is already registered. Please sign in on the Login page.' },
        409
      )
    }

    if (action === 'verify') {
      return jsonResponse({
        verified: true,
        employee: {
          id: employee.id,
          employee_code: employee.employee_code,
          full_name: employee.full_name,
          email: employee.email,
          designation: employee.designation,
          intended_role: employee.intended_role,
          department_name: (employee.department as { name?: string } | null)?.name ?? 'General',
          team_name: (employee.team as { name?: string } | null)?.name ?? null,
        },
      })
    }

    if (action === 'register') {
      if (password.length < 8) {
        return jsonResponse({ error: 'Password must be at least 8 characters long.' }, 400)
      }

      const { data: authData, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
        email: rawEmail,
        password,
        email_confirm: true,
        app_metadata: {
          role: employee.intended_role,
          employee_id: employee.id,
          employee_code: employee.employee_code,
        },
        user_metadata: {
          full_name: employee.full_name,
          employee_code: employee.employee_code,
        },
      })

      if (createUserError || !authData.user) {
        return jsonResponse({ error: createUserError?.message ?? 'Failed to create login account.' }, 400)
      }

      const updatePayload: Record<string, unknown> = {
        auth_user_id: authData.user.id,
        status: 'active',
        registered_at: new Date().toISOString(),
      }
      if (phone) {
        updatePayload.phone = phone
      }

      const { error: empUpdateError } = await supabaseAdmin
        .from('employees')
        .update(updatePayload)
        .eq('id', employee.id)
        .is('auth_user_id', null)

      if (empUpdateError) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return jsonResponse({ error: empUpdateError.message }, 500)
      }

      const { error: roleError } = await supabaseAdmin.from('user_roles').upsert(
        {
          user_id: authData.user.id,
          employee_id: employee.id,
          role: employee.intended_role,
        },
        { onConflict: 'user_id' }
      )

      if (roleError) {
        return jsonResponse({ error: roleError.message }, 500)
      }

      await supabaseAdmin.from('notifications').insert({
        recipient_employee_id: employee.id,
        type: 'account_activated',
        title: 'Welcome to VarTa',
        message: `Your verified employee account (${employee.employee_code}) is now active.`,
      })

      return jsonResponse({
        success: true,
        email: rawEmail,
        role: employee.intended_role,
      })
    }

    return jsonResponse({ error: 'Unsupported action' }, 400)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error' }, 500)
  }
})
