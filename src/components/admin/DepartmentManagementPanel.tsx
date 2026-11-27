/**
 * File: src/components/admin/DepartmentManagementPanel.tsx
 * Purpose: Super Admin Department Management console for creating unlimited departments, editing names,
 *   codes, descriptions, display order, assigning Department Heads, activating/deactivating units,
 *   and safely deleting departments that have no active or pending employees.
 * Connected files:
 *   - `src/components/admin/AdminModulesSection.tsx` (embedded inside Super Admin Dashboard)
 *   - `src/pages/EmployeesPage.tsx` (Departments tab)
 *   - `src/lib/supabase.ts` (`public.departments` + `prevent_in_use_department_delete_trg`)
 */
import React, { useMemo, useState } from 'react'
import { Building2, Edit3, Plus, Power, Trash2, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'
import { Modal } from '../ui/Modal'
import { Avatar } from '../ui/Avatar'
import { getDisplayEmployeeId, isFoundingMember } from '../../lib/orgUtils'
import type { Department, Designation, Employee } from '../../types/database'

interface DepartmentManagementPanelProps {
  departments: Department[]
  designations: Designation[]
  employees: Employee[]
  onChanged: () => void
}

export function DepartmentManagementPanel({
  departments,
  designations,
  employees,
  onChanged,
}: DepartmentManagementPanelProps) {
  const { toast } = useToast()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [headEmployeeId, setHeadEmployeeId] = useState('')
  const [displayOrder, setDisplayOrder] = useState(10)
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  const orderedDepartments = useMemo(
    () =>
      [...departments].sort(
        (a, b) => (a.display_order ?? 100) - (b.display_order ?? 100) || a.name.localeCompare(b.name)
      ),
    [departments]
  )

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'active').sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [employees]
  )

  const openCreate = () => {
    setEditing(null)
    setName('')
    setCode('')
    setDescription('')
    setHeadEmployeeId('')
    setDisplayOrder(departments.length + 1)
    setIsActive(true)
    setModalOpen(true)
  }

  const openEdit = (dept: Department) => {
    setEditing(dept)
    setName(dept.name)
    setCode(dept.code)
    setDescription(dept.description ?? '')
    setHeadEmployeeId(dept.head_employee_id ?? '')
    setDisplayOrder(dept.display_order ?? 10)
    setIsActive(dept.is_active ?? true)
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !code.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim(),
        head_employee_id: headEmployeeId || null,
        display_order: Math.max(0, Number(displayOrder) || 0),
        is_active: isActive,
      }
      const { error } = editing
        ? await supabase.from('departments').update(payload).eq('id', editing.id)
        : await supabase.from('departments').insert(payload)

      if (error) throw error
      toast({
        type: 'success',
        title: editing ? 'Department Updated' : 'Department Created',
        description: `${payload.name} (${payload.code}) saved cleanly.`,
      })
      setModalOpen(false)
      onChanged()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Department action failed',
        description: err instanceof Error ? err.message : 'Check code uniqueness and permissions',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (dept: Department) => {
    const next = !dept.is_active
    const { error } = await supabase.from('departments').update({ is_active: next }).eq('id', dept.id)
    if (error) {
      toast({ type: 'error', title: 'Status update failed', description: error.message })
    } else {
      toast({ type: 'success', title: next ? 'Department Activated' : 'Department Deactivated', description: dept.name })
      onChanged()
    }
  }

  const handleDelete = async (dept: Department, activeOrPendingCount: number) => {
    if (activeOrPendingCount > 0) {
      toast({
        type: 'warning',
        title: 'Department In Use',
        description: `${dept.name} has ${activeOrPendingCount} active or pending employee(s). Reassign them before deleting.`,
      })
      return
    }
    if (!window.confirm(`Delete department "${dept.name}" (${dept.code})?`)) return
    const { error } = await supabase.from('departments').delete().eq('id', dept.id)
    if (error) {
      toast({ type: 'error', title: 'Cannot delete department', description: error.message })
    } else {
      toast({ type: 'success', title: 'Department Deleted', description: dept.name })
      onChanged()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#151722] flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#4D4CEF]" />
            Department Management
          </h3>
          <p className="text-xs text-[#6E748C]">
            Add unlimited departments, assign heads, configure hierarchy display order, or activate/deactivate divisions.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-xs self-start sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" /> Add Department
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {orderedDepartments.map((dept) => {
          const deptEmps = employees.filter((e) => e.department_id === dept.id)
          const activeAssignedCount = deptEmps.filter((e) => e.status === 'active' || e.status === 'invited').length
          const activeMemberCount = deptEmps.filter((e) => e.status === 'active' && !isFoundingMember(e)).length
          const deptDesCount = designations.filter((d) => d.department_id === dept.id && d.is_active).length
          const head = employees.find((e) => e.id === dept.head_employee_id)

          return (
            <div
              key={dept.id}
              className={`varta-card rounded-[24px] p-4 flex flex-col justify-between gap-3 border transition-all ${
                dept.is_active ? 'border-[#E6E8F2]' : 'opacity-70 border-rose-200 bg-rose-50/20'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#EFF1F8] text-[#4D4CEF] border border-[#DFE3F2]">
                      #{dept.display_order} • {dept.code}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      dept.is_active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                  >
                    {dept.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div>
                  <h4 className="font-display text-sm font-bold text-[#151722] leading-snug">{dept.name}</h4>
                  <p className="text-[11px] text-[#6E748C] mt-1 line-clamp-2">
                    {dept.description || 'Enterprise department'}
                  </p>
                </div>

                <div className="p-2.5 rounded-xl bg-[#F7F8FC] border border-[#EAEDF6] flex items-center gap-2">
                  {head ? (
                    <>
                      <Avatar name={head.full_name} src={head.avatar_url} size="xs" shape="circle" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7D839B]">Dept Head</p>
                        <p className="text-xs font-bold text-[#151722] truncate">{head.full_name}</p>
                      </div>
                    </>
                  ) : (
                    <span className="text-[11px] text-[#8D92A8]">No Department Head assigned</span>
                  )}
                </div>
              </div>

              <div className="pt-2.5 border-t border-[#EEF0F7] flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5E647B]">
                  <Users className="h-3.5 w-3.5 text-[#4D4CEF]" />
                  {activeMemberCount} staff • {deptDesCount} roles
                </span>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(dept)}
                    title="Edit Department"
                    className="p-1.5 rounded-full bg-[#F4F5FA] hover:bg-[#4D4CEF]/10 text-[#666C85] hover:text-[#4D4CEF]"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(dept)}
                    title={dept.is_active ? 'Deactivate Department' : 'Activate Department'}
                    className={`p-1.5 rounded-full bg-[#F4F5FA] ${
                      dept.is_active ? 'hover:bg-amber-50 text-amber-600' : 'hover:bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(dept, activeAssignedCount)}
                    title={
                      activeAssignedCount > 0
                        ? 'Reassign active employees before deleting'
                        : 'Delete unused department'
                    }
                    className={`p-1.5 rounded-full bg-[#F4F5FA] ${
                      activeAssignedCount > 0
                        ? 'opacity-45 cursor-not-allowed text-[#9499AE]'
                        : 'hover:bg-rose-50 text-[#666C85] hover:text-rose-600'
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Department (${editing.code})` : 'Create New Department'}
        subtitle="Dynamically configure company departments, heads, and ordering"
      >
        <form onSubmit={handleSave} className="space-y-3.5">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-[#454A62] mb-1">Department Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Audio Visual (AV)"
                className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1">Short Code *</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="AV"
                className="varta-input w-full px-3.5 py-2 rounded-2xl font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1">Assign Department Head</label>
              <select
                value={headEmployeeId}
                onChange={(e) => setHeadEmployeeId(e.target.value)}
                className="varta-select w-full px-3 py-2 rounded-2xl text-xs"
              >
                <option value="">Unassigned</option>
                {activeEmployees.map((emp) => {
                  const empId = getDisplayEmployeeId(emp)
                  return (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} {empId ? `(${empId})` : '(Leadership)'}
                    </option>
                  )
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1">Display Order</label>
              <input
                type="number"
                min={0}
                required
                value={displayOrder}
                onChange={(e) => setDisplayOrder(Number(e.target.value))}
                className="varta-input w-full px-3.5 py-2 rounded-2xl font-mono text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scope and responsibilities of this department..."
              className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
            />
          </div>

          <label className="flex items-center gap-2 p-3 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-[#CFD4E6] text-[#4D4CEF]"
            />
            <span className="text-xs font-semibold text-[#151722]">Department is Active</span>
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-full bg-[#F1F3F9] text-xs font-semibold text-[#454A62]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-full bg-[#15161C] text-xs font-semibold text-white"
            >
              {saving ? 'Saving...' : editing ? 'Save Department' : 'Create Department'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
