/**
 * File: src/pages/EmployeesPage.tsx
 * Purpose: Full-page Super Admin Organization & Workforce Directory Console (`/employees`) providing tabbed
 *   access to Employee Management, Department Management, Designation Management, Leadership Management,
 *   plus Sub-Teams creation — powered by shared modular components in `src/components/admin/*`.
 * Connected files:
 *   - `src/App.tsx` (route `/employees`)
 *   - `src/contexts/AuthContext.tsx` (enforces `role === 'super_admin'`)
 *   - `src/components/admin/EmployeeManagementPanel.tsx`, `DepartmentManagementPanel.tsx`,
 *     `DesignationManagementPanel.tsx`, `LeadershipManagementPanel.tsx`
 *   - `src/components/employees/EmployeeFormModal.tsx`
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Award, Building2, Crown, Plus, Shield, UserPlus, Users, Layers } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import { isFoundingMember } from '../lib/orgUtils'
import { PageTransition } from '../components/ui/MotionPrimitives'
import { Modal } from '../components/ui/Modal'
import { EmployeeFormModal } from '../components/employees/EmployeeFormModal'
import { EmployeeManagementPanel } from '../components/admin/EmployeeManagementPanel'
import { DepartmentManagementPanel } from '../components/admin/DepartmentManagementPanel'
import { DesignationManagementPanel } from '../components/admin/DesignationManagementPanel'
import { LeadershipManagementPanel } from '../components/admin/LeadershipManagementPanel'
import type { Department, Designation, Employee, OrgCategory, Team } from '../types/database'

type ConsoleTab = 'employees' | 'departments' | 'designations' | 'leadership'

export function EmployeesPage() {
  const { role, employee: currentEmp } = useAuth()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState<ConsoleTab>('employees')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [designations, setDesignations] = useState<Designation[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [defaultCategory, setDefaultCategory] = useState<OrgCategory>('employee')
  const [modalMode, setModalMode] = useState<'employee' | 'leadership'>('employee')

  // Quick Sub-Team Creator Modal
  const [teamModalOpen, setTeamModalOpen] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDeptId, setNewTeamDeptId] = useState('')

  const loadData = useCallback(async () => {
    try {
      const [empRes, deptRes, desRes, teamRes] = await Promise.all([
        supabase
          .from('employees')
          .select('*, department:departments!employees_department_id_fkey(id, name, code), team:teams!employees_team_id_fkey(id, name, department_id)')
          .order('display_order', { ascending: true })
          .order('employee_code', { ascending: true }),
        supabase.from('departments').select('*').order('display_order').order('name'),
        supabase.from('designations').select('*').order('hierarchy_level').order('title'),
        supabase.from('teams').select('*, department:departments(*)').order('name'),
      ])
      setEmployees((empRes.data ?? []) as Employee[])
      setDepartments((deptRes.data ?? []) as Department[])
      setDesignations((desRes.data ?? []) as Designation[])
      setTeams((teamRes.data ?? []) as Team[])
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed loading organization directory',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const openCreateModal = useCallback((cat: OrgCategory = 'employee', mode: 'employee' | 'leadership' = 'employee') => {
    setEditing(null)
    setDefaultCategory(cat)
    setModalMode(mode)
    setModalOpen(true)
  }, [])

  const openEditModal = useCallback((emp: Employee) => {
    setEditing(emp)
    setDefaultCategory((emp.org_category || 'employee') as OrgCategory)
    setModalMode(isFoundingMember(emp) ? 'leadership' : 'employee')
    setModalOpen(true)
  }, [])

  useEffect(() => {
    const tabParam = searchParams.get('tab') as ConsoleTab | null
    if (tabParam && ['employees', 'departments', 'designations', 'leadership'].includes(tabParam)) {
      setActiveTab(tabParam)
    }
    if (searchParams.get('add') === '1' && !loading) {
      openCreateModal('employee')
      setSearchParams({})
    }
    const editId = searchParams.get('edit')
    if (editId && employees.length > 0) {
      const target = employees.find((e) => e.id === editId)
      if (target) openEditModal(target)
      setSearchParams({})
    }
  }, [searchParams, loading, employees, openCreateModal, openEditModal, setSearchParams])

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTeamName.trim() || !newTeamDeptId) return
    const { error } = await supabase.from('teams').insert({
      name: newTeamName.trim(),
      department_id: newTeamDeptId,
    })
    if (error) {
      toast({ type: 'error', title: 'Team failed', description: error.message })
    } else {
      setNewTeamName('')
      setTeamModalOpen(false)
      toast({ type: 'success', title: 'Sub-Team Created' })
      loadData()
    }
  }

  if (role !== 'super_admin') {
    return (
      <PageTransition>
        <div className="varta-card rounded-[28px] p-10 text-center max-w-lg mx-auto mt-10">
          <Shield className="h-10 w-10 text-rose-500 mx-auto mb-3" />
          <h2 className="font-display text-xl font-bold text-[#151722]">Super Admin Access Required</h2>
          <p className="text-sm text-[#666C85] mt-2">
            Only Super Admins can manage departments, designations, leadership categories, or employee records.
            Visit Teams to browse company colleagues.
          </p>
        </div>
      </PageTransition>
    )
  }

  const nonFoundingEmployees = employees.filter((e) => !isFoundingMember(e))

  const tabs: Array<{ id: ConsoleTab; label: string; count: number; icon: typeof Users }> = [
    { id: 'employees', label: 'Employees', count: nonFoundingEmployees.length, icon: Users },
    { id: 'departments', label: 'Departments', count: departments.length, icon: Building2 },
    { id: 'designations', label: 'Designations', count: designations.length, icon: Award },
    {
      id: 'leadership',
      label: 'Leadership',
      count: employees.filter((e) => isFoundingMember(e) || (e.org_category || 'employee') !== 'employee').length,
      icon: Crown,
    },
  ]

  return (
    <PageTransition className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight">
            Company Organization & Employees
          </h1>
          <p className="text-sm text-[#6E748C] mt-1">
            Manage departments, hierarchical designations, Leadership profiles, and AIPL employee records.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={() => {
              setNewTeamDeptId(departments[0]?.id ?? '')
              setTeamModalOpen(true)
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white hover:bg-[#F6F7FB] border border-[#E5E8F2] shadow-xs text-xs font-semibold text-[#151722] transition-colors"
          >
            <Layers className="h-4 w-4 text-[#4D4CEF]" />
            Add Sub-Team
          </button>
          <button
            onClick={() => openCreateModal('employee', 'employee')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-[0_10px_22px_-8px_rgba(21,22,28,0.4)] transition-all hover:scale-[1.02]"
          >
            <UserPlus className="h-4 w-4" />
            Add Employee
          </button>
        </div>
      </div>

      {/* Quick Summary KPI Strip (Excludes Company Founding Members from Employee Counts) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        {[
          { label: 'Total Employees', val: nonFoundingEmployees.length, cls: 'text-[#151722]' },
          {
            label: 'Active Departments',
            val: departments.filter((d) => d.is_active).length,
            cls: 'text-[#4D4CEF]',
          },
          {
            label: 'Active Designations',
            val: designations.filter((d) => d.is_active).length,
            cls: 'text-[#9C65E5]',
          },
          {
            label: 'Active Employees',
            val: nonFoundingEmployees.filter((e) => e.status === 'active').length,
            cls: 'text-emerald-600',
          },
        ].map((item) => (
          <div key={item.label} className="varta-card rounded-3xl p-4 sm:p-5">
            <p className="text-xs font-semibold text-[#7A8099]">{item.label}</p>
            <p className={`font-display text-2xl sm:text-3xl font-bold mt-1.5 ${item.cls}`}>{item.val}</p>
          </div>
        ))}
      </div>

      {/* Console Tab Bar */}
      <div className="varta-card rounded-[28px] p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap gap-2 border-b border-[#EEF0F7] pb-4">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold border transition-all ${active
                  ? 'bg-[#15161C] text-white border-[#15161C]'
                  : 'bg-[#F6F7FB] text-[#5E647B] border-[#E6E8F2] hover:bg-white hover:text-[#151722]'
                  }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? 'text-[#9C65E5]' : 'text-[#4D4CEF]'}`} />
                <span>{tab.label}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${active ? 'bg-white/15 text-white' : 'bg-white text-[#4D4CEF] border border-[#E2E5F2]'
                    }`}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        {activeTab === 'employees' && (
          <EmployeeManagementPanel
            employees={employees}
            departments={departments}
            currentEmployeeId={currentEmp?.id}
            onAddEmployee={() => openCreateModal('employee', 'employee')}
            onEditEmployee={openEditModal}
            onChanged={loadData}
          />
        )}

        {activeTab === 'departments' && (
          <DepartmentManagementPanel
            departments={departments}
            designations={designations}
            employees={employees}
            onChanged={loadData}
          />
        )}

        {activeTab === 'designations' && (
          <DesignationManagementPanel
            departments={departments}
            designations={designations}
            employees={employees}
            onChanged={loadData}
          />
        )}

        {activeTab === 'leadership' && (
          <LeadershipManagementPanel
            employees={employees}
            onAddLeader={(cat) => openCreateModal(cat, 'leadership')}
            onEditMember={openEditModal}
          />
        )}
      </div>

      {/* Shared Add / Edit Member Modal */}
      <EmployeeFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        employeesCount={nonFoundingEmployees.length}
        existingEmployees={employees}
        departments={departments}
        designations={designations}
        teams={teams}
        defaultCategory={defaultCategory}
        mode={modalMode}
        onSaved={loadData}
      />

      {/* Quick Sub-Team Creator Modal */}
      <Modal
        open={teamModalOpen}
        onClose={() => setTeamModalOpen(false)}
        title="Add Sub-Team"
        subtitle="Group members inside a department (optional)"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCreateTeam} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Parent Department *</label>
            <select
              value={newTeamDeptId}
              onChange={(e) => setNewTeamDeptId(e.target.value)}
              className="varta-select w-full px-3 py-2 rounded-2xl text-xs"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Sub-Team Name *</label>
            <input
              type="text"
              required
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="e.g. AV Integration Squad"
              className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setTeamModalOpen(false)}
              className="px-4 py-2 rounded-full bg-[#F1F3F9] text-xs font-semibold text-[#454A62]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#4D4CEF] text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" /> Create Sub-Team
            </button>
          </div>
        </form>
      </Modal>
    </PageTransition>
  )
}
