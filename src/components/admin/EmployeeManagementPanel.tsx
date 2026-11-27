/**
 * File: src/components/admin/EmployeeManagementPanel.tsx
 * Purpose: Modular Super Admin Employee Management console displaying summary KPIs, search,
 *   category/department/status filters, role assignments, Activate/Deactivate switches, and
 *   archive-safe removal (preserving all historical meeting/attendance records).
 * Connected files:
 *   - `src/components/admin/AdminModulesSection.tsx` (Admin Dashboard -> Employee Management tab)
 *   - `src/pages/EmployeesPage.tsx` (standalone `/employees` console)
 *   - `src/components/employees/EmployeeFormModal.tsx`
 *   - `supabase/functions/admin-manage-users/index.ts` (`update_role`, `set_status`, `delete_employee`)
 */
import { useMemo, useState } from 'react'
import { Edit3, Mail, Power, Search, Trash2, UserPlus } from 'lucide-react'
import { invokeEdgeFunction } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'
import { formatDate } from '../../lib/utils'
import { isFoundingMember } from '../../lib/orgUtils'
import { Avatar } from '../ui/Avatar'
import { CategoryBadge, EmployeeStatusBadge, RoleBadge } from '../ui/StatusBadge'
import { ORG_CATEGORY_OPTIONS } from '../employees/EmployeeFormModal'
import type { Department, Employee, UserRole } from '../../types/database'

interface EmployeeManagementPanelProps {
  employees: Employee[]
  departments: Department[]
  currentEmployeeId?: string
  onAddEmployee: () => void
  onEditEmployee: (emp: Employee) => void
  onChanged: () => void
  compact?: boolean
}

export function EmployeeManagementPanel({
  employees,
  departments,
  currentEmployeeId,
  onAddEmployee,
  onEditEmployee,
  onChanged,
  compact = false,
}: EmployeeManagementPanelProps) {
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const handleRoleChange = async (emp: Employee, nextRole: UserRole) => {
    try {
      await invokeEdgeFunction('admin-manage-users', {
        action: 'update_role',
        employee_id: emp.id,
        role: nextRole,
      })
      toast({
        type: 'success',
        title: 'Role Updated',
        description: `${emp.full_name} is now ${nextRole.replace('_', ' ').toUpperCase()}.`,
      })
      onChanged()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could not change role',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleToggleStatus = async (emp: Employee) => {
    const nextStatus = emp.status === 'inactive' ? 'active' : 'inactive'
    try {
      await invokeEdgeFunction('admin-manage-users', {
        action: 'set_status',
        employee_id: emp.id,
        status: nextStatus,
      })
      toast({
        type: 'success',
        title: nextStatus === 'inactive' ? 'Employee Deactivated' : 'Employee Reactivated',
        description: `${emp.full_name} (${emp.employee_code}) status updated.`,
      })
      onChanged()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Status change failed',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleDeleteEmployee = async (emp: Employee) => {
    if (!window.confirm(`Remove or archive ${emp.full_name} (${emp.employee_code})?`)) return
    try {
      const res = await invokeEdgeFunction<{ message?: string }>('admin-manage-users', {
        action: 'delete_employee',
        employee_id: emp.id,
      })
      toast({
        type: 'success',
        title: 'Employee Updated',
        description: res.message || `${emp.full_name} removed.`,
      })
      onChanged()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees.filter((e) => {
      // Keep company founding members exclusively in Leadership, never in Employees list
      if (isFoundingMember(e)) return false
      if (statusFilter && e.status !== statusFilter) return false
      if (deptFilter && e.department_id !== deptFilter) return false
      if (categoryFilter && (e.org_category || 'employee') !== categoryFilter) return false
      if (q) {
        const hay = `${e.employee_code} ${e.full_name} ${e.email} ${e.designation} ${e.department?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [employees, search, statusFilter, deptFilter, categoryFilter])

  const displayedRows = compact ? filtered.slice(0, 8) : filtered

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#151722]">Employee Management</h3>
          <p className="text-xs text-[#6E748C]">
            Add, edit, activate/deactivate, or assign departments, designations, and categories.
          </p>
        </div>
        <button
          onClick={onAddEmployee}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-xs self-start sm:self-auto"
        >
          <UserPlus className="h-3.5 w-3.5" /> Add Employee
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        <div className="lg:col-span-2 relative">
          <Search className="h-3.5 w-3.5 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search AIPL-001, full name, email, designation..."
          className="varta-input w-full pl-9 pr-3 py-2 rounded-2xl text-xs"
        />
      </div>
      <select
        value={categoryFilter}
        onChange={(e) => setCategoryFilter(e.target.value)}
        className="varta-select px-3 py-2 rounded-2xl text-xs"
      >
        <option value="">All Employee Tiers</option>
        {ORG_CATEGORY_OPTIONS.filter((opt) => opt.value !== 'founder' && opt.value !== 'managing_director').map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="varta-select px-3 py-2 rounded-2xl text-xs"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="varta-select px-3 py-2 rounded-2xl text-xs"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="invited">Pending Invite</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="rounded-[24px] border border-[#EAEDF6] overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF0F7] bg-[#F8F9FD] text-[11px] font-bold uppercase tracking-wider text-[#7A8099]">
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Department & Designation</th>
                <th className="py-3 px-4">Category & Order</th>
                <th className="py-3 px-4">Access Role</th>
                <th className="py-3 px-4">Status</th>
                {!compact && <th className="py-3 px-4">Joined</th>}
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F8] text-xs">
              {displayedRows.map((emp) => (
                <tr key={emp.id} className="hover:bg-[#F8F9FD] transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={emp.full_name} src={emp.avatar_url} size="sm" shape="circle" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EFF1F8] text-[#4D4CEF] border border-[#DFE3F2]">
                            {emp.employee_code}
                          </span>
                          <span className="font-bold text-[#151722]">{emp.full_name}</span>
                        </div>
                        <p className="text-[11px] text-[#8E94AA] flex items-center gap-1 mt-0.5">
                          <Mail className="h-3 w-3" /> {emp.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-semibold text-[#151722]">{emp.designation}</p>
                    <p className="text-[11px] text-[#6E748C]">{emp.department?.name || 'Unassigned'}</p>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <CategoryBadge category={emp.org_category || emp.member_category || 'employee'} />
                      <span className="font-mono text-[10px] text-[#7D839B]">#{emp.display_order ?? 100}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <select
                        value={emp.intended_role}
                        disabled={emp.id === currentEmployeeId}
                        onChange={(e) => handleRoleChange(emp, e.target.value as UserRole)}
                        className="varta-select px-2 py-1 rounded-xl text-xs disabled:opacity-60"
                      >
                        <option value="employee">Employee</option>
                        <option value="organizer">Organizer</option>
                        <option value="super_admin">Super Admin</option>
                      </select>
                      {!compact && <RoleBadge role={emp.intended_role} />}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <EmployeeStatusBadge status={emp.status} />
                  </td>
                  {!compact && <td className="py-3 px-4 text-[#6E748C]">{formatDate(emp.date_of_joining)}</td>}
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onEditEmployee(emp)}
                        title="Edit Employee"
                        className="p-1.5 rounded-full bg-[#F4F5FA] hover:bg-[#4D4CEF]/10 text-[#666C85] hover:text-[#4D4CEF]"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      {emp.id !== currentEmployeeId && (
                        <>
                          <button
                            onClick={() => handleToggleStatus(emp)}
                            title={emp.status === 'inactive' ? 'Activate' : 'Deactivate'}
                            className={`p-1.5 rounded-full bg-[#F4F5FA] ${
                              emp.status === 'inactive'
                                ? 'hover:bg-emerald-50 text-emerald-600'
                                : 'hover:bg-amber-50 text-amber-600'
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteEmployee(emp)}
                            title="Remove / Archive Employee"
                            className="p-1.5 rounded-full bg-[#F4F5FA] hover:bg-rose-50 text-[#666C85] hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {displayedRows.length === 0 && (
                <tr>
                  <td colSpan={compact ? 6 : 7} className="py-8 text-center text-xs text-[#8D92A8]">
                    No employees match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
