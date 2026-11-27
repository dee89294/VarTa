/**
 * File: src/components/admin/AdminModulesSection.tsx
 * Purpose: Unified Super Admin Organization & Meeting Control Center embedded inside `DashboardPage.tsx`
 *   featuring 5 non-crowded tabbed modules matching VarTa's design language:
 *   1. Employee Management
 *   2. Department Management
 *   3. Designation Management
 *   4. Leadership Management
 *   5. Meeting Management
 * Connected files:
 *   - `src/pages/DashboardPage.tsx` (rendered only when `role === 'super_admin'`)
 *   - `src/components/admin/*Panel.tsx` & `src/components/employees/EmployeeFormModal.tsx`
 *   - `src/lib/supabase.ts` (`employees`, `departments`, `designations`, `teams`)
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, Building2, Crown, ExternalLink, Users, Video } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { isFoundingMember } from '../../lib/orgUtils'
import { EmployeeFormModal } from '../employees/EmployeeFormModal'
import { EmployeeManagementPanel } from './EmployeeManagementPanel'
import { DepartmentManagementPanel } from './DepartmentManagementPanel'
import { DesignationManagementPanel } from './DesignationManagementPanel'
import { LeadershipManagementPanel } from './LeadershipManagementPanel'
import { MeetingManagementPanel } from './MeetingManagementPanel'
import type { Department, Designation, Employee, Meeting, OrgCategory, Team } from '../../types/database'

type AdminTab = 'employees' | 'departments' | 'designations' | 'leadership' | 'meetings'

export function AdminModulesSection({
  meetings,
  onMeetingChanged,
}: {
  meetings: Meeting[]
  onMeetingChanged: () => void
}) {
  const { employee: currentEmp } = useAuth()
  const [activeTab, setActiveTab] = useState<AdminTab>('employees')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [designations, setDesignations] = useState<Designation[]>([])
  const [teams, setTeams] = useState<Team[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<Employee | null>(null)
  const [defaultCategory, setDefaultCategory] = useState<OrgCategory>('employee')
  const [modalMode, setModalMode] = useState<'employee' | 'leadership'>('employee')

  const loadOrgData = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    loadOrgData()
    const ch = supabase
      .channel('admin-org-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => loadOrgData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => loadOrgData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'designations' }, () => loadOrgData())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [loadOrgData])

  const openCreateModal = (cat: OrgCategory = 'employee', mode: 'employee' | 'leadership' = 'employee') => {
    setEditingMember(null)
    setDefaultCategory(cat)
    setModalMode(mode)
    setModalOpen(true)
  }

  const openEditModal = (emp: Employee) => {
    setEditingMember(emp)
    setDefaultCategory((emp.org_category || 'employee') as OrgCategory)
    setModalMode(isFoundingMember(emp) ? 'leadership' : 'employee')
    setModalOpen(true)
  }

  const nonFoundingEmployees = employees.filter((e) => !isFoundingMember(e))

  const tabs: Array<{ id: AdminTab; label: string; count: number; icon: typeof Users }> = [
    { id: 'employees', label: 'Employee Management', count: nonFoundingEmployees.length, icon: Users },
    { id: 'departments', label: 'Department Management', count: departments.length, icon: Building2 },
    { id: 'designations', label: 'Designation Management', count: designations.length, icon: Award },
    {
      id: 'leadership',
      label: 'Leadership Management',
      count: employees.filter((e) => isFoundingMember(e) || (e.org_category || 'employee') !== 'employee').length,
      icon: Crown,
    },
    { id: 'meetings', label: 'Meeting Management', count: meetings.length, icon: Video },
  ]

  return (
    <section className="varta-card rounded-[30px] p-5 sm:p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[#EEF0F7] pb-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#4D4CEF]">
            Super Admin Command Hub
          </span>
          <h2 className="font-display text-xl font-bold text-[#151722] mt-0.5">
            Organization, Hierarchy & Meeting Operations
          </h2>
        </div>

        <Link
          to="/employees"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4D4CEF] hover:underline self-start lg:self-auto"
        >
          Open Full Directory Console <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* 5 Clean Module Switcher Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-semibold border transition-all ${
                active
                  ? 'bg-[#15161C] text-white border-[#15161C] shadow-xs'
                  : 'bg-[#F6F7FB] text-[#5E647B] border-[#E6E8F2] hover:text-[#151722] hover:bg-white'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? 'text-[#9C65E5]' : 'text-[#4D4CEF]'}`} />
              <span>{tab.label}</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                  active ? 'bg-white/15 text-white' : 'bg-white text-[#4D4CEF] border border-[#E2E5F2]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Active Module Body */}
      <div className="pt-1">
        {activeTab === 'employees' && (
          <EmployeeManagementPanel
            employees={employees}
            departments={departments}
            currentEmployeeId={currentEmp?.id}
            onAddEmployee={() => openCreateModal('employee', 'employee')}
            onEditEmployee={openEditModal}
            onChanged={loadOrgData}
            compact
          />
        )}

        {activeTab === 'departments' && (
          <DepartmentManagementPanel
            departments={departments}
            designations={designations}
            employees={employees}
            onChanged={loadOrgData}
          />
        )}

        {activeTab === 'designations' && (
          <DesignationManagementPanel
            departments={departments}
            designations={designations}
            employees={employees}
            onChanged={loadOrgData}
          />
        )}

        {activeTab === 'leadership' && (
          <LeadershipManagementPanel
            employees={employees}
            onAddLeader={(cat) => openCreateModal(cat, 'leadership')}
            onEditMember={openEditModal}
          />
        )}

        {activeTab === 'meetings' && (
          <MeetingManagementPanel
            meetings={meetings}
            departments={departments}
            onChanged={onMeetingChanged}
          />
        )}
      </div>

      <EmployeeFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editingMember}
        employeesCount={nonFoundingEmployees.length}
        existingEmployees={employees}
        departments={departments}
        designations={designations}
        teams={teams}
        defaultCategory={defaultCategory}
        mode={modalMode}
        onSaved={() => {
          loadOrgData()
          onMeetingChanged()
        }}
      />
    </section>
  )
}
