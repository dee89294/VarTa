/**
 * Handlers for `update_role`, `set_status`, and `delete_employee` in `admin-manage-users`.
 */
import { type AdminClient, jsonResponse } from './shared.ts'

export async function handleUpdateRole(
  supabaseAdmin: AdminClient,
  callerId: string,
  callerEmployeeId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const employee_id = String(body.employee_id ?? '')
  const role = String(body.role ?? '') as 'super_admin' | 'organizer' | 'employee'
  if (!employee_id || !['super_admin', 'organizer', 'employee'].includes(role)) {
    return jsonResponse({ error: 'Valid employee_id and role are required' }, 400)
  }
  if (employee_id === callerEmployeeId && role !== 'super_admin') {
    return jsonResponse({ error: 'You cannot remove your own Super Admin role.' }, 400)
  }

  const { data: emp } = await supabaseAdmin.from('employees').select('*').eq('id', employee_id).single()
  if (!emp) return jsonResponse({ error: 'Employee not found' }, 404)

  const { error: roleUpdateErr } = await supabaseAdmin
    .from('employees')
    .update({ intended_role: role })
    .eq('id', employee_id)
  if (roleUpdateErr) return jsonResponse({ error: roleUpdateErr.message }, 400)

  if (emp.auth_user_id) {
    const { error: roleUpsertErr } = await supabaseAdmin.from('user_roles').upsert(
      {
        user_id: emp.auth_user_id,
        employee_id,
        role,
        assigned_by: callerId,
      },
      { onConflict: 'user_id' }
    )
    if (roleUpsertErr) return jsonResponse({ error: roleUpsertErr.message }, 400)

    const { error: authMetaErr } = await supabaseAdmin.auth.admin.updateUserById(emp.auth_user_id, {
      app_metadata: { role, employee_id, employee_code: emp.employee_code },
    })
    if (authMetaErr) return jsonResponse({ error: authMetaErr.message }, 400)
  }

  await supabaseAdmin.from('notifications').insert({
    recipient_employee_id: employee_id,
    type: 'role_updated',
    title: 'Permissions Updated',
    message: `Your VarTa access role was updated to ${role.replace('_', ' ').toUpperCase()}.`,
  })

  return jsonResponse({ success: true, role })
}

export async function handleSetStatus(
  supabaseAdmin: AdminClient,
  callerEmployeeId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const employee_id = String(body.employee_id ?? '')
  const status = String(body.status ?? '') as 'active' | 'inactive' | 'invited'
  if (!employee_id || !['active', 'inactive', 'invited'].includes(status)) {
    return jsonResponse({ error: 'Valid employee_id and status required' }, 400)
  }
  if (employee_id === callerEmployeeId && status === 'inactive') {
    return jsonResponse({ error: 'You cannot deactivate your own Super Admin account.' }, 400)
  }

  const { data: emp } = await supabaseAdmin.from('employees').select('*').eq('id', employee_id).single()
  if (!emp) return jsonResponse({ error: 'Employee not found' }, 404)

  const nextStatus = status === 'active' && !emp.auth_user_id ? 'invited' : status
  const { error: statusErr } = await supabaseAdmin
    .from('employees')
    .update({ status: nextStatus })
    .eq('id', employee_id)
  if (statusErr) return jsonResponse({ error: statusErr.message }, 400)

  if (emp.auth_user_id) {
    const { error: authBanErr } = await supabaseAdmin.auth.admin.updateUserById(emp.auth_user_id, {
      ban_duration: nextStatus === 'inactive' ? '876000h' : 'none',
    })
    if (authBanErr) return jsonResponse({ error: authBanErr.message }, 400)
  }

  return jsonResponse({ success: true, status: nextStatus })
}

export async function handleDeleteEmployee(
  supabaseAdmin: AdminClient,
  callerEmployeeId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const employee_id = String(body.employee_id ?? '')
  if (!employee_id) return jsonResponse({ error: 'employee_id is required' }, 400)
  if (employee_id === callerEmployeeId) {
    return jsonResponse({ error: 'You cannot remove your own Super Admin account.' }, 400)
  }

  const { data: emp } = await supabaseAdmin.from('employees').select('*').eq('id', employee_id).single()
  if (!emp) return jsonResponse({ error: 'Employee not found' }, 404)

  // Preserve ALL historical meeting, participant, attendance, chat, and audit records!
  const [
    { count: organizedCount },
    { count: participantCount },
    { count: attendanceCount },
    { count: messageCount },
    { count: logCount },
  ] = await Promise.all([
    supabaseAdmin.from('meetings').select('id', { count: 'exact', head: true }).eq('organizer_id', employee_id),
    supabaseAdmin.from('meeting_participants').select('id', { count: 'exact', head: true }).eq('employee_id', employee_id),
    supabaseAdmin.from('attendance').select('id', { count: 'exact', head: true }).eq('employee_id', employee_id),
    supabaseAdmin.from('meeting_messages').select('id', { count: 'exact', head: true }).eq('sender_employee_id', employee_id),
    supabaseAdmin.from('meeting_activity_logs').select('id', { count: 'exact', head: true }).eq('actor_employee_id', employee_id),
  ])

  const hasHistoricalRecords =
    (organizedCount ?? 0) +
      (participantCount ?? 0) +
      (attendanceCount ?? 0) +
      (messageCount ?? 0) +
      (logCount ?? 0) >
    0

  if (hasHistoricalRecords) {
    const { error: archiveErr } = await supabaseAdmin
      .from('employees')
      .update({ status: 'inactive' })
      .eq('id', employee_id)
    if (archiveErr) return jsonResponse({ error: archiveErr.message }, 400)

    if (emp.auth_user_id) {
      const { error: archiveBanErr } = await supabaseAdmin.auth.admin.updateUserById(emp.auth_user_id, {
        ban_duration: '876000h',
      })
      if (archiveBanErr) return jsonResponse({ error: archiveBanErr.message }, 400)
    }
    return jsonResponse({
      success: true,
      archived: true,
      message:
        'Employee has historical meeting/attendance records, so their account was deactivated and archived to keep audit history intact.',
    })
  }

  if (emp.auth_user_id) {
    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(emp.auth_user_id)
    if (authDelErr) return jsonResponse({ error: authDelErr.message }, 400)
  }
  const { error: empDelErr } = await supabaseAdmin.from('employees').delete().eq('id', employee_id)
  if (empDelErr) return jsonResponse({ error: empDelErr.message }, 400)
  return jsonResponse({ success: true, deleted: true, message: `${emp.full_name} permanently removed.` })
}
