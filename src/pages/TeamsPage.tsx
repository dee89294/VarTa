/**
 * File: src/pages/TeamsPage.tsx
 * Purpose: Complete 5-tier Company Organization & Team Directory dynamically backed by Supabase (`employees`,
 *   `departments`, `designations`, `employee_social_links`), synced in real time and manageable inline by Super Admins.
 * Hierarchy Tiers Rendered:
 *   1. Founders & Managing Director (Large Hero Portrait Cards)
 *   2. Associate Director & Leadership (Large Executive Cards)
 *   3. Department Heads (Medium Spotlight Cards)
 *   4. Managers (Medium Functional Cards)
 *   5. Employees (Clean 4-Column Organized Grid)
 * Connected files:
 *   - `src/App.tsx` (route `/teams`)
 *   - `src/contexts/AuthContext.tsx` (`role`, `employee`)
 *   - `src/components/employees/EmployeeFormModal.tsx` (add/edit with dynamic department -> designation picker)
 *   - `src/lib/supabase.ts` & `supabase/functions/admin-manage-users/index.ts`
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Search,
  Mail,
  Linkedin,
  Globe,
  Twitter,
  Building2,
  UserPlus,
  Edit3,
  Trash2,
  Power,
  FilterX,
  UsersRound,
  Crown,
  Briefcase,
  Award,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { invokeEdgeFunction, supabase } from '../lib/supabase'
import { isFoundingMember } from '../lib/orgUtils'
import { PageTransition, ScrollReveal, StaggerGrid, StaggerItem } from '../components/ui/MotionPrimitives'
import { Avatar } from '../components/ui/Avatar'
import { CategoryBadge, EmployeeStatusBadge } from '../components/ui/StatusBadge'
import { EmployeeFormModal } from '../components/employees/EmployeeFormModal'
import type { Department, Designation, Employee, OrgCategory, Team } from '../types/database'

const CATEGORY_RANK: Record<string, number> = {
  founder: 1,
  managing_director: 2,
  co_founder: 3,
  director: 4,
  leadership: 5,
  department_head: 6,
  manager: 7,
  employee: 8,
}

export function TeamsPage() {
  const { role, employee: currentEmp } = useAuth()
  const { toast } = useToast()
  const [searchParams] = useSearchParams()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [designations, setDesignations] = useState<Designation[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)

  // Global Organization Filters & Search
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [deptFilter, setDeptFilter] = useState('')
  const [designationFilter, setDesignationFilter] = useState('')
  const [showInactiveAdmin, setShowInactiveAdmin] = useState(false)

  // Inline Super Admin Modal State
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<Employee | null>(null)
  const [defaultCategory, setDefaultCategory] = useState<OrgCategory>('employee')
  const [modalMode, setModalMode] = useState<'employee' | 'leadership'>('employee')

  const loadDirectory = useCallback(async () => {
    try {
      const [empRes, deptRes, desRes, teamRes] = await Promise.all([
        supabase
          .from('employees')
          .select(
            '*, department:departments!employees_department_id_fkey(id, name, code), team:teams!employees_team_id_fkey(id, name, department_id)'
          )
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
        title: 'Unable to load organization directory',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadDirectory()
    const ch = supabase
      .channel('teams-directory-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => loadDirectory())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => loadDirectory())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'designations' }, () => loadDirectory())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [loadDirectory])

  useEffect(() => {
    const q = searchParams.get('q')
    if (q !== null) setSearch(q)
  }, [searchParams])

  const activeDepartments = useMemo(
    () =>
      departments
        .filter((d) => d.is_active)
        .sort((a, b) => (a.display_order ?? 100) - (b.display_order ?? 100) || a.name.localeCompare(b.name)),
    [departments]
  )

  const sortMembers = useCallback(
    (list: Employee[]) =>
      [...list].sort((a, b) => {
        const rankDiff =
          (CATEGORY_RANK[a.org_category || a.member_category || 'employee'] ?? 8) -
          (CATEGORY_RANK[b.org_category || b.member_category || 'employee'] ?? 8)
        if (rankDiff !== 0) return rankDiff
        const orderDiff = (a.display_order ?? 100) - (b.display_order ?? 100)
        if (orderDiff !== 0) return orderDiff
        return a.employee_code.localeCompare(b.employee_code)
      }),
    []
  )

  // Base visibility pool: active employees only unless Super Admin toggles deactivated/invited preview
  const visiblePool = useMemo(() => {
    return employees.filter((e) => {
      if (role !== 'super_admin' || !showInactiveAdmin) {
        return e.status === 'active'
      }
      return true
    })
  }, [employees, role, showInactiveAdmin])

  const filteredPool = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = visiblePool.filter((e) => {
      if (deptFilter && e.department_id !== deptFilter) return false
      if (designationFilter && e.designation !== designationFilter) return false
      if (q) {
        const hay = `${e.full_name} ${e.employee_code} ${e.email} ${e.designation} ${e.bio} ${e.department?.name ?? ''} ${e.team?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return sortMembers(list)
  }, [visiblePool, search, deptFilter, designationFilter, sortMembers])

  const distinctDesignations = useMemo(
    () => Array.from(new Set(visiblePool.map((e) => e.designation).filter(Boolean))).sort(),
    [visiblePool]
  )

  // Partition members cleanly into the exact 5 Hierarchy Tiers
  const tiers = useMemo(() => {
    const getCat = (e: Employee): string => e.org_category || e.member_category || 'employee'
    const foundersMd = filteredPool.filter((e) => ['founder', 'managing_director'].includes(getCat(e)))
    const directorsLeadership = filteredPool.filter((e) => ['director', 'co_founder', 'leadership'].includes(getCat(e)))
    const deptHeads = filteredPool.filter((e) => getCat(e) === 'department_head')
    const managers = filteredPool.filter((e) => getCat(e) === 'manager')
    const regularEmployees = filteredPool.filter((e) => getCat(e) === 'employee')
    return { foundersMd, directorsLeadership, deptHeads, managers, regularEmployees }
  }, [filteredPool])

  // Employee counts & department pills strictly exclude Company Founding Members
  const employeeCountPool = useMemo(
    () => visiblePool.filter((e) => !isFoundingMember(e)),
    [visiblePool]
  )

  const openAddMemberModal = (category: OrgCategory, mode: 'employee' | 'leadership' = 'employee') => {
    setEditingMember(null)
    setDefaultCategory(category)
    setModalMode(mode)
    setModalOpen(true)
  }

  const openEditMemberModal = (emp: Employee) => {
    setEditingMember(emp)
    setDefaultCategory((emp.org_category || 'employee') as OrgCategory)
    setModalMode(isFoundingMember(emp) ? 'leadership' : 'employee')
    setModalOpen(true)
  }

  const handleToggleActive = async (emp: Employee) => {
    const nextStatus = emp.status === 'inactive' ? 'active' : 'inactive'
    try {
      await invokeEdgeFunction('admin-manage-users', {
        action: 'set_status',
        employee_id: emp.id,
        status: nextStatus,
      })
      toast({
        type: 'success',
        title: nextStatus === 'inactive' ? 'Profile Deactivated' : 'Profile Activated',
        description: `${emp.full_name} is now ${nextStatus}.`,
      })
      loadDirectory()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Status update failed',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleRemoveMember = async (emp: Employee) => {
    if (!window.confirm(`Remove or archive ${emp.full_name} (${emp.employee_code})?`)) return
    try {
      const res = await invokeEdgeFunction<{ message?: string }>('admin-manage-users', {
        action: 'delete_employee',
        employee_id: emp.id,
      })
      toast({
        type: 'success',
        title: 'Profile Updated',
        description: res.message || `${emp.full_name} removed from directory.`,
      })
      loadDirectory()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const renderSocialLinks = (emp: Employee, size: 'lg' | 'md' | 'sm') => {
    const iconCls = size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'
    const btnCls =
      size === 'lg'
        ? 'h-9 w-9 rounded-xl bg-[#F4F5FA] hover:bg-[#4D4CEF] text-[#5E647B] hover:text-white border border-[#E5E8F3] hover:border-[#4D4CEF] flex items-center justify-center transition-all'
        : 'h-7 w-7 rounded-lg bg-[#F4F5FA] hover:bg-[#4D4CEF]/12 text-[#666C85] hover:text-[#4D4CEF] flex items-center justify-center transition-colors'
    return (
      <div className="flex items-center gap-1.5">
        {emp.linkedin_url && (
          <a href={emp.linkedin_url} target="_blank" rel="noreferrer" title="LinkedIn Profile" className={btnCls}>
            <Linkedin className={iconCls} />
          </a>
        )}
        {emp.twitter_url && (
          <a href={emp.twitter_url} target="_blank" rel="noreferrer" title="X / Twitter" className={btnCls}>
            <Twitter className={iconCls} />
          </a>
        )}
        {emp.website_url && (
          <a href={emp.website_url} target="_blank" rel="noreferrer" title="Website" className={btnCls}>
            <Globe className={iconCls} />
          </a>
        )}
        <a href={`mailto:${emp.email}`} title={`Email ${emp.full_name}`} className={btnCls}>
          <Mail className={iconCls} />
        </a>
      </div>
    )
  }

  const renderAdminControls = (emp: Employee) =>
    role === 'super_admin' ? (
      <div className="flex items-center gap-1">
        <button
          onClick={() => openEditMemberModal(emp)}
          title="Edit Profile"
          className="p-1.5 rounded-full bg-[#F4F5FA] hover:bg-[#4D4CEF]/12 text-[#666C85] hover:text-[#4D4CEF] transition-colors"
        >
          <Edit3 className="h-3.5 w-3.5" />
        </button>
        {emp.id !== currentEmp?.id && (
          <>
            <button
              onClick={() => handleToggleActive(emp)}
              title={emp.status === 'inactive' ? 'Activate Profile' : 'Deactivate Profile'}
              className={`p-1.5 rounded-full bg-[#F4F5FA] transition-colors ${
                emp.status === 'inactive' ? 'hover:bg-emerald-50 text-emerald-600' : 'hover:bg-amber-50 text-amber-600'
              }`}
            >
              <Power className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleRemoveMember(emp)}
              title="Remove / Archive Member"
              className="p-1.5 rounded-full bg-[#F4F5FA] hover:bg-rose-50 text-[#666C85] hover:text-rose-600 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    ) : null

  return (
    <PageTransition className="space-y-10 pb-8">
      {/* ===================================================================== */}
      {/* HEADER & ORGANIZATION FILTER BAR                                      */}
      {/* ===================================================================== */}
      <section className="varta-card rounded-[28px] p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-[#4D4CEF]/10 text-[#4D4CEF]">
              <Building2 className="h-3.5 w-3.5" />
              Company Organization & Team Directory
            </span>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#151722] tracking-tight mt-2">
              Leadership, Departments & People
            </h1>
            <p className="text-xs sm:text-sm text-[#6E748C] mt-0.5">
              Live organizational directory organized across Founders, Directors, Department Heads, Managers, and Specialists.
            </p>
          </div>

          {role === 'super_admin' && (
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#F6F7FB] border border-[#DDE1F0] text-xs font-semibold text-[#454A62] cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInactiveAdmin}
                  onChange={(e) => setShowInactiveAdmin(e.target.checked)}
                  className="rounded border-[#CFD4E6] text-[#4D4CEF]"
                />
                Show Deactivated / Invited
              </label>
              <button
                onClick={() => openAddMemberModal('employee', 'employee')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-xs transition-all hover:scale-[1.02]"
              >
                <UserPlus className="h-4 w-4" />
                Add Team Member
              </button>
            </div>
          )}
        </div>

        {/* Dynamic Department Filter Pills (Employee counts exclude Founding Members) */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => setDeptFilter('')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              !deptFilter
                ? 'bg-[#15161C] text-white border-[#15161C]'
                : 'bg-white text-[#5E647B] border-[#E5E8F2] hover:text-[#151722]'
            }`}
          >
            All Departments ({employeeCountPool.length} Employees)
          </button>
          {activeDepartments.map((d) => {
            const count = employeeCountPool.filter((e) => e.department_id === d.id).length
            return (
              <button
                key={d.id}
                onClick={() => setDeptFilter(d.id === deptFilter ? '' : d.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  deptFilter === d.id
                    ? 'bg-[#4D4CEF] text-white border-[#4D4CEF] shadow-xs'
                    : 'bg-white text-[#5E647B] border-[#E5E8F2] hover:text-[#151722]'
                }`}
              >
                {d.name}{' '}
                <span className={deptFilter === d.id ? 'text-white/80 ml-1' : 'text-[#8D92A8] ml-1'}>({count})</span>
              </button>
            )
          })}
        </div>

        {/* Search & Designation Filter */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
          <div className="sm:col-span-6 relative">
            <Search className="h-4 w-4 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, ID (AIPL-002), email, department, or designation..."
              className="varta-input w-full pl-10 pr-4 py-2 rounded-2xl text-xs"
            />
          </div>
          <select
            value={designationFilter}
            onChange={(e) => setDesignationFilter(e.target.value)}
            className="sm:col-span-4 varta-select px-3 py-2 rounded-2xl text-xs"
          >
            <option value="">All Designations</option>
            {distinctDesignations.map((des) => (
              <option key={des} value={des}>
                {des}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setSearch('')
              setDeptFilter('')
              setDesignationFilter('')
            }}
            className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-2xl bg-[#F3F4F9] hover:bg-[#E7EAF5] text-xs font-semibold text-[#454A62]"
          >
            <FilterX className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </section>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="varta-card rounded-[28px] h-72 animate-pulse" />
          ))}
        </div>
      ) : filteredPool.length === 0 ? (
        <div className="varta-card rounded-[28px] p-12 text-center space-y-2">
          <UsersRound className="h-8 w-8 text-[#9499AE] mx-auto" />
          <p className="font-display text-base font-bold text-[#151722]">No Matching Organization Members</p>
          <p className="text-xs text-[#6E748C]">Try clearing the search query or selecting another department filter.</p>
        </div>
      ) : (
        <div className="space-y-12">
          {/* ================================================================= */}
          {/* TIER 1 & TIER 2: EXECUTIVE LEADERSHIP SHOWCASE                    */}
          {/* ================================================================= */}
          {(tiers.foundersMd.length > 0 || tiers.directorsLeadership.length > 0) && (
            <section className="relative rounded-[34px] bg-gradient-to-br from-[#EAEBFA] via-white to-[#F2ECFD] border border-[#DFE2F5] p-6 sm:p-10 overflow-hidden shadow-[0_24px_64px_-22px_rgba(45,48,112,0.16)] space-y-10">
              <div className="absolute -top-28 left-1/4 h-72 w-72 rounded-full bg-[#4D4CEF]/12 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 right-1/5 h-72 w-72 rounded-full bg-[#9C65E5]/14 blur-3xl pointer-events-none" />

              <div className="relative z-10 max-w-3xl mx-auto text-center space-y-2.5">
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold bg-white/90 text-[#4D4CEF] border border-[#4D4CEF]/20 shadow-xs">
                  <Crown className="h-3.5 w-3.5 text-[#9C65E5]" />
                  Executive Vision & Company Leadership
                </span>
                <h2 className="font-display text-3xl sm:text-4xl font-extrabold text-[#151722] tracking-tight">
                  Meet the People Behind Our Vision
                </h2>
                <p className="text-sm text-[#5E647B] max-w-xl mx-auto">
                  The founders, directors, and visionary leaders guiding our engineering, AV, and enterprise teams.
                </p>
              </div>

              {/* Tier 1: Founders & Managing Director (Largest Hero Portrait Cards) */}
              {tiers.foundersMd.length > 0 && (
                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold uppercase tracking-wider text-[#4D4CEF]">
                      1. Founders & Managing Director
                    </h3>
                    {role === 'super_admin' && (
                      <button
                        onClick={() => openAddMemberModal('founder', 'leadership')}
                        className="text-xs font-semibold text-[#151722] hover:text-[#4D4CEF] inline-flex items-center gap-1"
                      >
                        <UserPlus className="h-3.5 w-3.5" /> Add Founder / MD
                      </button>
                    )}
                  </div>

                  <StaggerGrid
                    className={`grid gap-6 ${
                      tiers.foundersMd.length === 1
                        ? 'max-w-lg mx-auto grid-cols-1'
                        : tiers.foundersMd.length === 2
                          ? 'max-w-4xl mx-auto grid-cols-1 md:grid-cols-2'
                          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                    }`}
                  >
                    {tiers.foundersMd.map((leader) => (
                      <StaggerItem key={leader.id}>
                        <motion.article
                          whileHover={{ y: -6 }}
                          transition={{ duration: 0.25 }}
                          className={`group rounded-[30px] p-5 sm:p-6 flex flex-col h-full bg-gradient-to-b from-white to-[#F7F6FE] border border-[#4D4CEF]/25 shadow-[0_22px_50px_-16px_rgba(77,76,239,0.22)] hover:shadow-[0_28px_60px_-14px_rgba(77,76,239,0.32)] transition-all ${
                            leader.status !== 'active' ? 'opacity-70' : ''
                          }`}
                        >
                          <div className="relative h-72 lg:h-80 w-full rounded-[22px] overflow-hidden mb-5 bg-gradient-to-br from-[#ECEEFF] via-[#E3E5F8] to-[#EFE8FC] border border-white shadow-inner">
                            <Avatar name={leader.full_name} src={leader.avatar_url} size="2xl" zoomOnHover />
                            <div className="absolute top-3 left-3 flex items-center gap-1.5">
                              <CategoryBadge category={leader.org_category || 'founder'} />
                              {leader.status !== 'active' && <EmployeeStatusBadge status={leader.status} />}
                            </div>
                          </div>

                          <div className="flex-1 space-y-2">
                            <h4 className="font-display text-2xl font-extrabold text-[#151722] group-hover:text-[#4D4CEF] transition-colors">
                              {leader.full_name}
                            </h4>
                            <p className="text-sm font-bold bg-gradient-to-r from-[#4D4CEF] to-[#9C65E5] bg-clip-text text-transparent">
                              {leader.designation}
                            </p>
                            <p className="text-xs font-semibold text-[#7D839B] inline-flex items-center gap-1">
                              <Building2 className="h-3.5 w-3.5 text-[#4D4CEF]" />
                              {leader.department?.name || 'Management'}
                            </p>
                            <p className="text-xs sm:text-sm text-[#5E647B] leading-relaxed line-clamp-3 pt-1">
                              {leader.bio || 'Guiding long-term corporate strategy and excellence.'}
                            </p>
                          </div>

                          <div className="mt-5 pt-4 border-t border-[#ECEEF6] flex items-center justify-between gap-2">
                            {renderSocialLinks(leader, 'lg')}
                            {renderAdminControls(leader)}
                          </div>
                        </motion.article>
                      </StaggerItem>
                    ))}
                  </StaggerGrid>
                </div>
              )}

              {/* Tier 2: Associate Director & Leadership (Large Executive Cards) */}
              {tiers.directorsLeadership.length > 0 && (
                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold uppercase tracking-wider text-[#773DC8]">
                      2. Associate Director & Leadership
                    </h3>
                    {role === 'super_admin' && (
                      <button
                        onClick={() => openAddMemberModal('director')}
                        className="text-xs font-semibold text-[#151722] hover:text-[#4D4CEF] inline-flex items-center gap-1"
                      >
                        <UserPlus className="h-3.5 w-3.5" /> Add Director / Leader
                      </button>
                    )}
                  </div>

                  <StaggerGrid
                    className={`grid gap-6 ${
                      tiers.directorsLeadership.length === 1
                        ? 'max-w-lg mx-auto grid-cols-1'
                        : tiers.directorsLeadership.length === 2
                          ? 'max-w-4xl mx-auto grid-cols-1 md:grid-cols-2'
                          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                    }`}
                  >
                    {tiers.directorsLeadership.map((leader) => (
                      <StaggerItem key={leader.id}>
                        <motion.article
                          whileHover={{ y: -5 }}
                          transition={{ duration: 0.25 }}
                          className={`group rounded-[28px] p-5 flex flex-col h-full bg-white/95 border border-[#E4E7F4] shadow-[0_18px_44px_-16px_rgba(32,38,88,0.14)] hover:border-[#9C65E5]/45 transition-all ${
                            leader.status !== 'active' ? 'opacity-70' : ''
                          }`}
                        >
                          <div className="relative h-64 lg:h-72 w-full rounded-[20px] overflow-hidden mb-4 bg-[#EFF1F8] border border-white">
                            <Avatar name={leader.full_name} src={leader.avatar_url} size="2xl" zoomOnHover />
                            <div className="absolute top-3 left-3 flex items-center gap-1.5">
                              <CategoryBadge category={leader.org_category || leader.member_category || 'director'} />
                              {leader.status !== 'active' && <EmployeeStatusBadge status={leader.status} />}
                            </div>
                          </div>

                          <div className="flex-1 space-y-1.5">
                            <h4 className="font-display text-xl font-extrabold text-[#151722] group-hover:text-[#4D4CEF] transition-colors">
                              {leader.full_name}
                            </h4>
                            <p className="text-xs sm:text-sm font-bold text-[#4D4CEF]">{leader.designation}</p>
                            <p className="text-xs font-semibold text-[#7D839B] inline-flex items-center gap-1">
                              <Building2 className="h-3.5 w-3.5 text-[#9C65E5]" />
                              {leader.department?.name || 'Management'}
                            </p>
                            <p className="text-xs text-[#5E647B] leading-relaxed line-clamp-3 pt-1">
                              {leader.bio || 'Leading strategic execution and multi-team alignment.'}
                            </p>
                          </div>

                          <div className="mt-4 pt-3.5 border-t border-[#ECEEF6] flex items-center justify-between gap-2">
                            {renderSocialLinks(leader, 'lg')}
                            {renderAdminControls(leader)}
                          </div>
                        </motion.article>
                      </StaggerItem>
                    ))}
                  </StaggerGrid>
                </div>
              )}
            </section>
          )}

          {/* ================================================================= */}
          {/* TIER 3: DEPARTMENT HEADS (Medium-Sized Cards)                     */}
          {/* ================================================================= */}
          {tiers.deptHeads.length > 0 && (
            <ScrollReveal className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#4D4CEF]">
                    <Award className="h-3.5 w-3.5" /> 3. Department Heads
                  </span>
                  <h2 className="font-display text-2xl font-bold text-[#151722] mt-0.5">Department Leadership</h2>
                </div>
                {role === 'super_admin' && (
                  <button
                    onClick={() => openAddMemberModal('department_head')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] text-xs font-semibold text-[#151722]"
                  >
                    <UserPlus className="h-3.5 w-3.5 text-[#4D4CEF]" /> Add Dept Head
                  </button>
                )}
              </div>

              <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {tiers.deptHeads.map((head) => (
                  <StaggerItem key={head.id}>
                    <motion.article
                      whileHover={{ y: -4 }}
                      className={`group varta-card varta-card-hover rounded-[26px] p-5 flex flex-col h-full border border-[#4D4CEF]/20 ${
                        head.status !== 'active' ? 'opacity-70' : ''
                      }`}
                    >
                      <div className="relative h-52 w-full rounded-[18px] overflow-hidden mb-4 bg-[#EFF1F8] border border-[#E6E8F2]">
                        <Avatar name={head.full_name} src={head.avatar_url} size="2xl" zoomOnHover />
                        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                          <CategoryBadge category="department_head" />
                          {head.status !== 'active' && <EmployeeStatusBadge status={head.status} />}
                        </div>
                      </div>

                      <div className="flex-1 space-y-1.5">
                        <h3 className="font-display text-lg font-bold text-[#151722] group-hover:text-[#4D4CEF] transition-colors">
                          {head.full_name}
                        </h3>
                        <p className="text-xs font-bold text-[#4D4CEF]">{head.designation}</p>
                        <p className="text-xs font-semibold text-[#6E748C] inline-flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5 text-[#4D4CEF]" />
                          {head.department?.name || 'Department'}
                        </p>
                        <p className="text-xs text-[#6E748C] line-clamp-2 leading-relaxed pt-1">
                          {head.bio || `Leads operations and technical delivery for ${head.department?.name || 'their department'}.`}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#EEF0F7] flex items-center justify-between gap-2">
                        {renderSocialLinks(head, 'md')}
                        {renderAdminControls(head)}
                      </div>
                    </motion.article>
                  </StaggerItem>
                ))}
              </StaggerGrid>
            </ScrollReveal>
          )}

          {/* ================================================================= */}
          {/* TIER 4: MANAGERS (Medium-Sized Cards)                             */}
          {/* ================================================================= */}
          {tiers.managers.length > 0 && (
            <ScrollReveal className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-600">
                    <Briefcase className="h-3.5 w-3.5" /> 4. Managers & Project Leads
                  </span>
                  <h2 className="font-display text-2xl font-bold text-[#151722] mt-0.5">Management Team</h2>
                </div>
                {role === 'super_admin' && (
                  <button
                    onClick={() => openAddMemberModal('manager')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] text-xs font-semibold text-[#151722]"
                  >
                    <UserPlus className="h-3.5 w-3.5 text-[#4D4CEF]" /> Add Manager
                  </button>
                )}
              </div>

              <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {tiers.managers.map((mgr) => (
                  <StaggerItem key={mgr.id}>
                    <motion.article
                      whileHover={{ y: -4 }}
                      className={`group varta-card varta-card-hover rounded-[26px] p-5 flex flex-col h-full border border-[#E5E8F2] ${
                        mgr.status !== 'active' ? 'opacity-70' : ''
                      }`}
                    >
                      <div className="relative h-52 w-full rounded-[18px] overflow-hidden mb-4 bg-[#EFF1F8] border border-[#E6E8F2]">
                        <Avatar name={mgr.full_name} src={mgr.avatar_url} size="2xl" zoomOnHover />
                        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                          <CategoryBadge category="manager" />
                          {mgr.status !== 'active' && <EmployeeStatusBadge status={mgr.status} />}
                        </div>
                      </div>

                      <div className="flex-1 space-y-1.5">
                        <h3 className="font-display text-lg font-bold text-[#151722] group-hover:text-[#4D4CEF] transition-colors">
                          {mgr.full_name}
                        </h3>
                        <p className="text-xs font-bold text-[#4D4CEF]">{mgr.designation}</p>
                        <p className="text-xs font-semibold text-[#6E748C] inline-flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5 text-[#4D4CEF]" />
                          {mgr.department?.name || 'Operations'}
                        </p>
                        <p className="text-xs text-[#6E748C] line-clamp-2 leading-relaxed pt-1">
                          {mgr.bio || `Coordinates schedules and cross-functional workflows in ${mgr.department?.name || 'VarTa'}.`}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#EEF0F7] flex items-center justify-between gap-2">
                        {renderSocialLinks(mgr, 'md')}
                        {renderAdminControls(mgr)}
                      </div>
                    </motion.article>
                  </StaggerItem>
                ))}
              </StaggerGrid>
            </ScrollReveal>
          )}

          {/* ================================================================= */}
          {/* TIER 5: EMPLOYEES (Clean 4-Column Organized Grid)                 */}
          {/* ================================================================= */}
          <ScrollReveal className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#5E647B]">
                  <UsersRound className="h-3.5 w-3.5 text-[#4D4CEF]" /> 5. Our Team / Specialists
                </span>
                <h2 className="font-display text-2xl font-bold text-[#151722] mt-0.5">Meet Our Team</h2>
                <p className="text-xs sm:text-sm text-[#6E748C]">
                  Talented engineers, technicians, and executives powering every department.
                </p>
              </div>
              {role === 'super_admin' && (
                <button
                  onClick={() => openAddMemberModal('employee')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-xs font-semibold text-white"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Add Employee
                </button>
              )}
            </div>

            {tiers.regularEmployees.length === 0 ? (
              <div className="varta-card rounded-[24px] p-8 text-center text-xs text-[#8D92A8]">
                No regular team members match this department or search filter.
              </div>
            ) : (
              <StaggerGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {tiers.regularEmployees.map((emp) => (
                  <StaggerItem key={emp.id}>
                    <div
                      className={`group varta-card varta-card-hover rounded-[24px] p-4 flex flex-col h-full ${
                        emp.status !== 'active' ? 'opacity-75' : ''
                      }`}
                    >
                      <div className="relative h-44 w-full rounded-2xl overflow-hidden mb-3.5 border border-[#E7E9F3] bg-[#EFF1F8]">
                        <Avatar name={emp.full_name} src={emp.avatar_url} size="2xl" zoomOnHover />
                        <div className="absolute top-2.5 left-2.5">
                          <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/90 backdrop-blur-md text-[#4D4CEF] shadow-2xs">
                            {emp.employee_code}
                          </span>
                        </div>
                        {emp.status !== 'active' && (
                          <div className="absolute top-2.5 right-2.5">
                            <EmployeeStatusBadge status={emp.status} />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 space-y-1.5">
                        <h3 className="font-display text-base font-bold text-[#151722] group-hover:text-[#4D4CEF] transition-colors truncate">
                          {emp.full_name}
                        </h3>
                        <p className="text-xs font-semibold text-[#4D4CEF] truncate">{emp.designation}</p>
                        <p className="text-[11px] font-medium text-[#7D839B] inline-flex items-center gap-1 truncate">
                          <Building2 className="h-3 w-3 text-[#9499AE] shrink-0" />
                          {emp.department?.name || 'VarTa'}
                        </p>
                        <p className="text-xs text-[#6E748C] line-clamp-2 leading-relaxed pt-0.5">
                          {emp.bio || `${emp.designation} in ${emp.department?.name || 'VarTa'}.`}
                        </p>
                      </div>

                      <div className="mt-3.5 pt-3 border-t border-[#EEF0F7] flex items-center justify-between gap-2">
                        {renderSocialLinks(emp, 'sm')}
                        {renderAdminControls(emp)}
                      </div>
                    </div>
                  </StaggerItem>
                ))}
              </StaggerGrid>
            )}
          </ScrollReveal>
        </div>
      )}

      {/* Dynamic Super Admin Editor Modal */}
      <EmployeeFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editingMember}
        employeesCount={employeeCountPool.length}
        existingEmployees={employees}
        departments={departments}
        designations={designations}
        teams={teams}
        defaultCategory={defaultCategory}
        mode={modalMode}
        onSaved={loadDirectory}
      />
    </PageTransition>
  )
}
