/**
 * Edge Function: admin-manage-users
 * Purpose: Privileged HR, Organization Hierarchy & RBAC administration endpoint exclusively for Super Admins.
 * Connected modules: `./shared.ts`, `./createEmployee.ts`, `./updateEmployee.ts`, `./roleStatusActions.ts`.
 */
import { corsHeaders, jsonResponse, requireSuperAdmin } from './shared.ts'
import { handleCreateEmployee } from './createEmployee.ts'
import { handleUpdateEmployee } from './updateEmployee.ts'
import { handleDeleteEmployee, handleSendOnboardingInvite, handleSetStatus, handleUpdateRole } from './roleStatusActions.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const auth = await requireSuperAdmin(req)
    if ('errorResponse' in auth) return auth.errorResponse

    const { supabaseAdmin, callerId, callerEmployeeId } = auth
    const body = (await req.json()) as Record<string, unknown>
    const action = body?.action as string

    if (action === 'create_employee') {
      return await handleCreateEmployee(supabaseAdmin, callerId, body)
    }
    if (action === 'update_employee') {
      return await handleUpdateEmployee(supabaseAdmin, callerId, callerEmployeeId, body)
    }
    if (action === 'update_role') {
      return await handleUpdateRole(supabaseAdmin, callerId, callerEmployeeId, body)
    }
    if (action === 'set_status') {
      return await handleSetStatus(supabaseAdmin, callerEmployeeId, body)
    }
    if (action === 'delete_employee') {
      return await handleDeleteEmployee(supabaseAdmin, callerEmployeeId, body)
    }
    if (action === 'send_onboarding_invite') {
      return await handleSendOnboardingInvite(supabaseAdmin, body)
    }

    return jsonResponse({ error: 'Unsupported action' }, 400)
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unexpected server error' }, 500)
  }
})
