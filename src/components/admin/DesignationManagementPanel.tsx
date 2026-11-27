/**
 * File: src/components/admin/DesignationManagementPanel.tsx
 * Purpose: Super Admin Designation Management console for creating department-scoped designations,
 *   setting hierarchy priority levels, reusing existing designation templates across departments,
 *   editing details, and safely preventing deletion of designations currently held by employees.
 * Connected files:
 *   - `src/components/admin/AdminModulesSection.tsx` & `src/pages/EmployeesPage.tsx`
 *   - `src/components/employees/EmployeeFormModal.tsx` (populates designations dynamically by department)
 *   - `src/lib/supabase.ts` (`public.designations` + `prevent_in_use_designation_delete_trg`)
 */
import React, { useMemo, useState } from 'react'
import { Award, Copy, Edit3, Plus, Search, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'
import { Modal } from '../ui/Modal'
import { CategoryBadge } from '../ui/StatusBadge'
import { ORG_CATEGORY_OPTIONS } from '../employees/EmployeeFormModal'
import type { Department, Designation, Employee, OrgCategory } from '../../types/database'

interface DesignationManagementPanelProps {
  departments: Department[]
  designations: Designation[]
  employees: Employee[]
  onChanged: () => void
}

export function DesignationManagementPanel({
  departments,
  designations,
  employees,
  onChanged,
}: DesignationManagementPanelProps) {
  const { toast } = useToast()

  const [deptFilter, setDeptFilter] = useState('')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Designation | null>(null)

  const [departmentId, setDepartmentId] = useState('')
  const [title, setTitle] = useState('')
  const [hierarchyLevel, setHierarchyLevel] = useState(50)
  const [defaultCategory, setDefaultCategory] = useState<OrgCategory>('employee')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  const uniqueTitles = useMemo(
    () => Array.from(new Set(designations.map((d) => d.title))).sort(),
    [designations]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return designations
      .filter((d) => {
        if (deptFilter && d.department_id !== deptFilter) return false
        if (q) {
          const deptName = departments.find((dp) => dp.id === d.department_id)?.name ?? ''
          if (!`${d.title} ${deptName} ${d.description}`.toLowerCase().includes(q)) return false
        }
        return true
      })
      .sort((a, b) => (a.hierarchy_level ?? 50) - (b.hierarchy_level ?? 50) || a.title.localeCompare(b.title))
  }, [designations, departments, deptFilter, search])

  const openCreate = (seed?: Partial<Designation>) => {
    setEditing(null)
    setDepartmentId(seed?.department_id ?? deptFilter ?? departments[0]?.id ?? '')
    setTitle(seed?.title ?? '')
    setHierarchyLevel(seed?.hierarchy_level ?? 50)
    setDefaultCategory(seed?.default_category ?? 'employee')
    setDescription(seed?.description ?? '')
    setIsActive(true)
    setModalOpen(true)
  }

  const openEdit = (des: Designation) => {
    setEditing(des)
    setDepartmentId(des.department_id)
    setTitle(des.title)
    setHierarchyLevel(des.hierarchy_level)
    setDefaultCategory(des.default_category)
    setDescription(des.description ?? '')
    setIsActive(des.is_active)
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!departmentId || !title.trim()) return
    setSaving(true)
    try {
      const payload = {
        department_id: departmentId,
        title: title.trim(),
        hierarchy_level: Math.max(1, Math.min(999, Number(hierarchyLevel) || 50)),
        default_category: defaultCategory,
        description: description.trim(),
        is_active: isActive,
      }
      const { error } = editing
        ? await supabase.from('designations').update(payload).eq('id', editing.id)
        : await supabase.from('designations').insert(payload)
      if (error) throw error
      toast({
        type: 'success',
        title: editing ? 'Designation Updated' : 'Designation Created',
        description: `"${payload.title}" saved with hierarchy priority ${payload.hierarchy_level}.`,
      })
      setModalOpen(false)
      onChanged()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Check uniqueness within the selected department',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (des: Designation, assignedCount: number) => {
    if (assignedCount > 0) {
      toast({
        type: 'warning',
        title: 'Designation In Use',
        description: `${assignedCount} active or pending employee(s) currently hold "${des.title}". Reassign them first.`,
      })
      return
    }
    if (!window.confirm(`Delete designation "${des.title}"?`)) return
    const { error } = await supabase.from('designations').delete().eq('id', des.id)
    if (error) {
      toast({ type: 'error', title: 'Delete blocked', description: error.message })
    } else {
      toast({ type: 'success', title: 'Designation Deleted', description: des.title })
      onChanged()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#151722] flex items-center gap-2">
            <Award className="h-5 w-5 text-[#4D4CEF]" />
            Designation & Hierarchy Management
          </h3>
          <p className="text-xs text-[#6E748C]">
            Assign roles to departments, set hierarchy priority levels, and reuse existing titles across teams.
          </p>
        </div>
        <button
          onClick={() => openCreate()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-xs self-start sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" /> Add Designation
        </button>
      </div>

      {/* Filters */}
      <div className="grid sm:grid-cols-3 gap-2.5">
        <div className="sm:col-span-2 relative">
          <Search className="h-3.5 w-3.5 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search designation title or department..."
            className="varta-input w-full pl-9 pr-3 py-2 rounded-2xl text-xs"
          />
        </div>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="varta-select px-3 py-2 rounded-2xl text-xs"
        >
          <option value="">All Departments ({designations.length})</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-[24px] border border-[#EAEDF6] overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF0F7] bg-[#F8F9FD] text-[11px] font-bold uppercase tracking-wider text-[#7A8099]">
                <th className="py-3 px-4">Designation</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Priority Level</th>
                <th className="py-3 px-4">Default Category</th>
                <th className="py-3 px-4">Staff Assigned</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F8] text-xs">
              {filtered.map((des) => {
                const dept = departments.find((d) => d.id === des.department_id)
                const assignedCount = employees.filter(
                  (e) =>
                    (e.designation_id === des.id ||
                      (e.department_id === des.department_id &&
                        e.designation.toLowerCase() === des.title.toLowerCase())) &&
                    e.status !== 'inactive'
                ).length

                return (
                  <tr key={des.id} className="hover:bg-[#F8F9FD] transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-bold text-[#151722]">{des.title}</p>
                      {des.description && <p className="text-[11px] text-[#7D839B] line-clamp-1">{des.description}</p>}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#EFF1F8] text-[#4D4CEF]">
                        {dept?.name || '—'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-[#454A62]">L{des.hierarchy_level}</td>
                    <td className="py-3 px-4">
                      <CategoryBadge category={des.default_category} />
                    </td>
                    <td className="py-3 px-4 font-semibold text-[#151722]">{assignedCount}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() =>
                            openCreate({
                              title: des.title,
                              hierarchy_level: des.hierarchy_level,
                              default_category: des.default_category,
                              description: des.description,
                            })
                          }
                          title="Reuse / Clone Designation to Another Department"
                          className="p-1.5 rounded-full bg-[#F4F5FA] hover:bg-[#9C65E5]/15 text-[#666C85] hover:text-[#773DC8]"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => openEdit(des)}
                          title="Edit Designation"
                          className="p-1.5 rounded-full bg-[#F4F5FA] hover:bg-[#4D4CEF]/10 text-[#666C85] hover:text-[#4D4CEF]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(des, assignedCount)}
                          title={assignedCount > 0 ? 'Reassign employees before deleting' : 'Delete Designation'}
                          className={`p-1.5 rounded-full bg-[#F4F5FA] ${
                            assignedCount > 0
                              ? 'opacity-45 cursor-not-allowed text-[#9499AE]'
                              : 'hover:bg-rose-50 text-[#666C85] hover:text-rose-600'
                          }`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-[#8D92A8]">
                    No designations match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit Designation (${editing.title})` : 'Add / Reuse Designation'}
        subtitle="Set department scope, hierarchy priority (lower = higher executive rank), and category default"
      >
        <form onSubmit={handleSave} className="space-y-3.5">
          {!editing && uniqueTitles.length > 0 && (
            <div className="p-3 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2]">
              <label className="block text-[11px] font-bold text-[#454A62] mb-1">
                Reuse Existing Designation Title (Optional Quick-Fill)
              </label>
              <select
                value=""
                onChange={(e) => {
                  const chosenTitle = e.target.value
                  if (!chosenTitle) return
                  const template = designations.find((d) => d.title === chosenTitle)
                  setTitle(chosenTitle)
                  if (template) {
                    setHierarchyLevel(template.hierarchy_level)
                    setDefaultCategory(template.default_category)
                    if (!description) setDescription(template.description)
                  }
                }}
                className="varta-select w-full px-3 py-1.5 rounded-xl text-xs bg-white"
              >
                <option value="">Choose an existing title to reuse...</option>
                {uniqueTitles.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1">Department *</label>
              <select
                required
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="varta-select w-full px-3 py-2 rounded-2xl text-xs"
              >
                <option value="">Select department...</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1">Designation Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. AV Engineer or Project Manager"
                className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1">
                Hierarchy Priority (1 = Executive)
              </label>
              <input
                type="number"
                min={1}
                max={999}
                required
                value={hierarchyLevel}
                onChange={(e) => setHierarchyLevel(Number(e.target.value))}
                className="varta-input w-full px-3.5 py-2 rounded-2xl font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1">Suggested Org Category</label>
              <select
                value={defaultCategory}
                onChange={(e) => setDefaultCategory(e.target.value as OrgCategory)}
                className="varta-select w-full px-3 py-2 rounded-2xl text-xs"
              >
                {ORG_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Role Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Summary of responsibilities..."
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
            <span className="text-xs font-semibold text-[#151722]">Designation is Active</span>
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
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Designation'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
