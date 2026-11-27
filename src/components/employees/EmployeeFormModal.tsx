/**
 * File: src/components/employees/EmployeeFormModal.tsx
 * Purpose: Shared Super Admin form modal for adding and editing employees and leadership profiles with
 *   dynamic Department selection, department-filtered Designations, `AIPL-(numbers)` Employee ID
 *   generation/validation, and automatic exclusion of Founding Members (`founder`, `managing_director`)
 *   from Employee IDs and regular Employee creation.
 * Connected files:
 *   - `src/components/admin/EmployeeManagementPanel.tsx` & `LeadershipManagementPanel.tsx`
 *   - `src/pages/EmployeesPage.tsx` & `src/pages/TeamsPage.tsx`
 *   - `src/lib/orgUtils.ts` (`generateNextAiplCode`, `isValidAiplEmployeeId`, `FOUNDING_CATEGORIES`)
 *   - `supabase/functions/admin-manage-users/index.ts` (`create_employee`, `update_employee`)
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Crown, KeyRound, MailCheck, ShieldCheck, Upload } from 'lucide-react'
import { invokeEdgeFunction, supabase } from '../../lib/supabase'
import { generateStrongPassword } from '../../lib/utils'
import { useToast } from '../../contexts/ToastContext'
import {
  FOUNDING_CATEGORIES,
  generateNextAiplCode,
  isFoundingMember,
  isValidAiplEmployeeId,
} from '../../lib/orgUtils'
import { Modal } from '../ui/Modal'
import { Avatar } from '../ui/Avatar'
import type {
  Department,
  Designation,
  Employee,
  EmployeeStatus,
  OrgCategory,
  Team,
  UserRole,
} from '../../types/database'

interface EmployeeFormModalProps {
  open: boolean
  onClose: () => void
  editing: Employee | null
  employeesCount: number
  existingEmployees?: Employee[]
  departments: Department[]
  designations: Designation[]
  teams: Team[]
  defaultCategory?: OrgCategory
  mode?: 'employee' | 'leadership'
  onSaved: () => void
}

export const ORG_CATEGORY_OPTIONS: Array<{ value: OrgCategory; label: string; hint: string }> = [
  { value: 'founder', label: 'Founder', hint: 'Founding Leadership Only (No Employee ID)' },
  { value: 'managing_director', label: 'Managing Director', hint: 'Founding Leadership Only (No Employee ID)' },
  { value: 'director', label: 'Director', hint: 'Tier 2 — Associate Director & Leadership' },
  { value: 'leadership', label: 'Leadership', hint: 'Tier 2 — Senior Leadership' },
  { value: 'department_head', label: 'Department Head', hint: 'Tier 3 — Medium Head Card' },
  { value: 'manager', label: 'Manager', hint: 'Tier 4 — Medium Manager Card' },
  { value: 'employee', label: 'Employee', hint: 'Tier 5 — Team Grid Card' },
]

export function EmployeeFormModal({
  open,
  onClose,
  editing,
  employeesCount,
  existingEmployees = [],
  departments,
  designations,
  teams,
  defaultCategory = 'employee',
  mode = 'employee',
  onSaved,
}: EmployeeFormModalProps) {
  const { toast } = useToast()

  const [empCode, setEmpCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [designationId, setDesignationId] = useState('')
  const [customDesignation, setCustomDesignation] = useState('')
  const [teamId, setTeamId] = useState('')
  const [intendedRole, setIntendedRole] = useState<UserRole>('employee')
  const [orgCategory, setOrgCategory] = useState<OrgCategory>('employee')
  const [displayOrder, setDisplayOrder] = useState(10)
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [twitterUrl, setTwitterUrl] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [dateOfJoining, setDateOfJoining] = useState(new Date().toISOString().slice(0, 10))
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<EmployeeStatus>('invited')
  const [passwordSetupMode, setPasswordSetupMode] = useState<'self_service' | 'admin_set'>('self_service')
  const [password, setPassword] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)

  const isFoundingSelected = FOUNDING_CATEGORIES.includes(orgCategory)

  const availableCategoryOptions = useMemo(() => {
    if (mode === 'leadership' || isFoundingMember(editing)) {
      return ORG_CATEGORY_OPTIONS
    }
    return ORG_CATEGORY_OPTIONS.filter((opt) => !FOUNDING_CATEGORIES.includes(opt.value))
  }, [mode, editing])

  const orderedDepartments = useMemo(() => {
    const activeOnly = departments.filter((d) => d.is_active || d.id === departmentId)
    return [...activeOnly].sort((a, b) => (a.display_order ?? 100) - (b.display_order ?? 100) || a.name.localeCompare(b.name))
  }, [departments, departmentId])

  const filteredDesignations = useMemo(() => {
    if (!departmentId) return []
    return designations
      .filter((d) => d.department_id === departmentId && (d.is_active || d.id === designationId))
      .sort((a, b) => (a.hierarchy_level ?? 50) - (b.hierarchy_level ?? 50) || a.title.localeCompare(b.title))
  }, [designations, departmentId, designationId])

  const filteredTeamsForDept = useMemo(
    () => teams.filter((t) => !departmentId || t.department_id === departmentId),
    [teams, departmentId]
  )

  useEffect(() => {
    if (!open) return
    if (editing) {
      const rawCat: string = editing.org_category || editing.member_category || 'employee'
      const resolvedCat = (rawCat === 'co_founder' ? 'director' : rawCat) as OrgCategory
      setOrgCategory(resolvedCat)
      setEmpCode(
        FOUNDING_CATEGORIES.includes(resolvedCat) || editing.employee_code.startsWith('FOUNDER-')
          ? generateNextAiplCode(existingEmployees)
          : editing.employee_code
      )
      setFullName(editing.full_name)
      setEmail(editing.email)
      setPhone(editing.phone)
      const dept = editing.department_id ?? orderedDepartments[0]?.id ?? ''
      setDepartmentId(dept)
      const matchedDes =
        designations.find((d) => d.id === editing.designation_id) ||
        designations.find(
          (d) => d.department_id === dept && d.title.toLowerCase() === (editing.designation ?? '').trim().toLowerCase()
        )
      setDesignationId(matchedDes?.id ?? '')
      setCustomDesignation(matchedDes ? '' : editing.designation ?? '')
      setTeamId(editing.team_id ?? '')
      setIntendedRole(editing.intended_role)
      setDisplayOrder(editing.display_order ?? 100)
      setLinkedinUrl(editing.linkedin_url ?? '')
      setTwitterUrl(editing.twitter_url ?? '')
      setWebsiteUrl(editing.website_url ?? '')
      setDateOfJoining(editing.date_of_joining)
      setBio(editing.bio)
      setAvatarUrl(editing.avatar_url)
      setStatus(editing.status)
      setPasswordSetupMode(editing.auth_user_id ? 'admin_set' : 'self_service')
      setPassword('')
    } else {
      const nextNum = employeesCount + 1
      const initialCat =
        mode === 'employee' && FOUNDING_CATEGORIES.includes(defaultCategory) ? 'employee' : defaultCategory
      const initialIsFounding = FOUNDING_CATEGORIES.includes(initialCat)
      const firstDept = departments.find((d) => d.is_active)?.id ?? departments[0]?.id ?? ''
      const firstDeptDes = designations
        .filter((d) => d.department_id === firstDept && d.is_active)
        .sort((a, b) => a.hierarchy_level - b.hierarchy_level)
      setEmpCode(
        existingEmployees.length > 0
          ? generateNextAiplCode(existingEmployees)
          : `AIPL-${String(nextNum).padStart(3, '0')}`
      )
      setFullName('')
      setEmail('')
      setPhone('')
      setDepartmentId(firstDept)
      setDesignationId(firstDeptDes[0]?.id ?? '')
      setCustomDesignation('')
      setTeamId('')
      setIntendedRole(initialCat === 'employee' || initialCat === 'manager' ? 'employee' : 'organizer')
      setOrgCategory(initialCat)
      setDisplayOrder(initialCat === 'employee' ? nextNum * 10 : nextNum)
      setLinkedinUrl('')
      setTwitterUrl('')
      setWebsiteUrl('')
      setDateOfJoining(new Date().toISOString().slice(0, 10))
      setBio('')
      setAvatarUrl(null)
      setStatus(initialIsFounding ? 'active' : 'invited')
      setPasswordSetupMode(initialIsFounding ? 'admin_set' : 'self_service')
      setPassword('')
    }
  }, [open, editing, employeesCount, existingEmployees, departments, designations, defaultCategory, mode])

  const handleDepartmentChange = (nextDeptId: string) => {
    setDepartmentId(nextDeptId)
    setTeamId('')
    const matching = designations
      .filter((d) => d.department_id === nextDeptId && d.is_active)
      .sort((a, b) => a.hierarchy_level - b.hierarchy_level)
    const first = matching[0]
    setDesignationId(first?.id ?? '')
    setCustomDesignation('')
    if (!editing && first?.default_category) {
      if (mode === 'leadership' || !FOUNDING_CATEGORIES.includes(first.default_category)) {
        setOrgCategory(first.default_category)
      }
    }
  }

  const handleDesignationSelect = (nextDesId: string) => {
    setDesignationId(nextDesId)
    setCustomDesignation('')
    const selected = designations.find((d) => d.id === nextDesId)
    if (!editing && selected?.default_category) {
      if (mode === 'leadership' || !FOUNDING_CATEGORIES.includes(selected.default_category)) {
        setOrgCategory(selected.default_category)
      }
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    try {
      const ext = file.name.split('.').pop() || 'png'
      const path = `employees/${empCode || Date.now()}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
      toast({ type: 'success', title: 'Photo uploaded to Supabase Storage' })
    } catch (err) {
      toast({
        type: 'error',
        title: 'Photo upload failed',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setUploadingPhoto(false)
    }
  }

  const generateTempPassword = () => {
    setPassword(generateStrongPassword(12))
  }

  const handleCategoryChange = (nextCat: OrgCategory) => {
    setOrgCategory(nextCat)
    if (FOUNDING_CATEGORIES.includes(nextCat) && status === 'invited') {
      setStatus('active')
      setPasswordSetupMode('admin_set')
    }
  }

  const handleStatusChange = (nextStatus: EmployeeStatus) => {
    setStatus(nextStatus)
    if (nextStatus === 'invited') {
      setPasswordSetupMode('self_service')
      setPassword('')
    } else if (nextStatus === 'active') {
      setPasswordSetupMode('admin_set')
    }
  }

  const handleSetupModeChange = (nextMode: 'self_service' | 'admin_set') => {
    setPasswordSetupMode(nextMode)
    if (nextMode === 'self_service') {
      setStatus('invited')
      setPassword('')
    } else {
      setStatus('active')
    }
  }

  const resolvedDesignationTitle =
    designations.find((d) => d.id === designationId)?.title ?? customDesignation.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!departmentId) {
      toast({ type: 'warning', title: 'Select a Department', description: 'Every member must belong to an organization department.' })
      return
    }
    if (!isFoundingSelected && !isValidAiplEmployeeId(empCode)) {
      toast({
        type: 'warning',
        title: 'Invalid Employee ID format',
        description: 'Employee ID must follow AIPL-(numbers), such as AIPL-001 or AIPL-104.',
      })
      return
    }
    if (!designationId && !customDesignation.trim()) {
      toast({
        type: 'warning',
        title: 'Select a Designation',
        description: 'Pick a designation belonging to the chosen department (or add one in Designation Management).',
      })
      return
    }

    const willCreateAccountNow = !editing && status === 'active' && (isFoundingSelected || passwordSetupMode === 'admin_set')
    if (willCreateAccountNow && password.trim().length < 8) {
      toast({
        type: 'warning',
        title: 'Password required',
        description: 'Enter or generate at least 8 characters, or switch to Employee Self-Setup.',
      })
      return
    }
    if (editing && password.trim().length > 0 && password.trim().length < 8) {
      toast({
        type: 'warning',
        title: 'Password too short',
        description: 'New password must be at least 8 characters (or leave blank to keep unchanged).',
      })
      return
    }

    setSaving(true)
    try {
      const payload = {
        employee_code: isFoundingSelected ? undefined : empCode.trim().toUpperCase(),
        full_name: fullName,
        email,
        phone,
        department_id: departmentId,
        team_id: teamId || null,
        designation_id: designationId || null,
        designation: resolvedDesignationTitle,
        intended_role: intendedRole,
        org_category: orgCategory,
        member_category: orgCategory,
        display_order: Number(displayOrder) || 0,
        linkedin_url: linkedinUrl,
        twitter_url: twitterUrl,
        website_url: websiteUrl,
        date_of_joining: dateOfJoining,
        bio,
        avatar_url: avatarUrl,
        status: !editing && !isFoundingSelected && status !== 'inactive' ? (passwordSetupMode === 'admin_set' ? 'active' : 'invited') : status,
      }

      if (editing) {
        await invokeEdgeFunction('admin-manage-users', {
          action: 'update_employee',
          employee_id: editing.id,
          ...payload,
          ...(password.trim() ? { password: password.trim() } : {}),
        })
        toast({
          type: 'success',
          title: isFoundingSelected ? 'Leadership Profile Updated' : 'Employee Updated',
          description: password.trim()
            ? `${fullName} saved with updated login credentials.`
            : isFoundingSelected
              ? `${fullName} saved.`
              : `${fullName} (${empCode}) saved.`,
        })
      } else {
        const res = await invokeEdgeFunction<{ mode: string }>('admin-manage-users', {
          action: 'create_employee',
          ...payload,
          create_account_now: willCreateAccountNow,
          password: willCreateAccountNow ? password : '',
        })
        toast({
          type: 'success',
          title: isFoundingSelected
            ? 'Founding Leadership Added'
            : res.mode === 'active'
              ? 'Employee Created & Activated'
              : res.mode === 'inactive'
                ? 'Employee Created (Inactive)'
                : 'Employee Saved for Self-Setup',
          description: isFoundingSelected
            ? `${fullName} added to Company Leadership (excluded from Employee counts/IDs).`
            : res.mode === 'invited'
              ? `${fullName} (${empCode}) can now generate their own password on /register using Employee ID ${empCode} & ${email}.`
              : `${fullName} (${empCode}) saved cleanly.`,
        })
      }
      onClose()
      onSaved()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        editing
          ? isFoundingSelected
            ? `Edit Leadership Member (${editing.full_name})`
            : `Edit Employee (${editing.employee_code})`
          : isFoundingSelected || mode === 'leadership'
            ? 'Add Leadership / Founding Member'
            : 'Add Company Employee'
      }
      subtitle="Assign Department, Department-filtered Designation, Category Tier, and Workspace Access"
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Portrait Uploader */}
        <div className="flex items-center gap-4 p-3.5 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2]">
          <Avatar name={fullName || 'New Member'} src={avatarUrl} size="lg" shape="circle" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-[#151722]">Profile Photograph</p>
            <p className="text-[11px] text-[#7D839B] mt-0.5">Stored in Supabase Storage (`avatars`) and displayed across Directory & Calls</p>
          </div>
          <label className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white hover:bg-[#EFF1F8] border border-[#DDE1EE] text-xs font-semibold text-[#151722] shadow-2xs shrink-0">
            <Upload className="h-3.5 w-3.5 text-[#4D4CEF]" />
            {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
            <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
          </label>
        </div>

        {/* Hierarchy Category, Status & Display Order */}
        <div className="grid sm:grid-cols-4 gap-3 p-3.5 rounded-2xl bg-[#4D4CEF]/[0.05] border border-[#4D4CEF]/20">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-[#151722] mb-1">Organization Category *</label>
            <select
              value={orgCategory}
              onChange={(e) => handleCategoryChange(e.target.value as OrgCategory)}
              className="varta-select w-full px-3.5 py-2 rounded-2xl text-xs bg-white font-semibold"
            >
              {availableCategoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.hint})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#151722] mb-1">Status *</label>
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as EmployeeStatus)}
              className="varta-select w-full px-3 py-2 rounded-2xl text-xs bg-white font-semibold"
            >
              <option value="active">
                {editing?.auth_user_id || isFoundingSelected ? 'Active' : 'Active (Admin Password)'}
              </option>
              {!editing?.auth_user_id && !isFoundingSelected && (
                <option value="invited">Self-Setup (Pending Invite)</option>
              )}
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#151722] mb-1">Display Order</label>
            <input
              type="number"
              min={0}
              required
              value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value))}
              className="varta-input w-full px-3 py-2 rounded-2xl text-xs bg-white font-mono font-bold"
            />
          </div>
        </div>

        {isFoundingSelected && (
          <div className="p-3 rounded-2xl bg-[#9C65E5]/10 border border-[#9C65E5]/25 flex items-center gap-2.5 text-xs text-[#454A62]">
            <Crown className="h-4 w-4 text-[#773DC8] shrink-0" />
            <span>
              <strong>Founding Leadership Profile:</strong> Excluded from Employee lists, Employee IDs (`AIPL-`), and Employee counts.
            </span>
          </div>
        )}

        {/* Core Identity & Dynamic Department -> Designation */}
        <div className="grid sm:grid-cols-2 gap-3.5">
          {!isFoundingSelected && (
            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1">
                Employee ID * <span className="text-[10px] font-normal text-[#7D839B]">(Format: AIPL-numbers)</span>
              </label>
              <input
                type="text"
                required
                pattern="^AIPL-[0-9]+$"
                title="Must start with AIPL- followed by numbers (e.g. AIPL-001)"
                placeholder="AIPL-009"
                value={empCode}
                onChange={(e) => setEmpCode(e.target.value.toUpperCase())}
                className="varta-input w-full px-3.5 py-2 rounded-2xl font-mono text-xs"
              />
            </div>
          )}
          <div className={isFoundingSelected ? 'sm:col-span-2' : ''}>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Full Name *</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Official Email Address *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Contact Number</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 ..."
              className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
            />
          </div>

          {/* Dynamic Department Dropdown */}
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Department *</label>
            <select
              required
              value={departmentId}
              onChange={(e) => handleDepartmentChange(e.target.value)}
              className="varta-select w-full px-3.5 py-2 rounded-2xl text-xs font-medium"
            >
              <option value="">Select department...</option>
              {orderedDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code}){!d.is_active ? ' [Inactive]' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Filtered Designation Dropdown automatically populated for Selected Department */}
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">
              Designation *{' '}
              <span className="text-[10px] font-normal text-[#7D839B]">(filtered by department)</span>
            </label>
            {filteredDesignations.length > 0 ? (
              <select
                required={!customDesignation.trim()}
                value={designationId}
                onChange={(e) => handleDesignationSelect(e.target.value)}
                className="varta-select w-full px-3.5 py-2 rounded-2xl text-xs font-medium"
              >
                <option value="">Select designation...</option>
                {filteredDesignations.map((des) => (
                  <option key={des.id} value={des.id}>
                    {des.title} (Priority {des.hierarchy_level})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                required
                value={customDesignation}
                onChange={(e) => setCustomDesignation(e.target.value)}
                placeholder="No active designations in this dept — type title"
                className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Sub-Team (Optional)</label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="varta-select w-full px-3.5 py-2 rounded-2xl text-xs"
            >
              <option value="">No specific sub-team</option>
              {filteredTeamsForDept.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Joining Date *</label>
            <input
              type="date"
              required
              value={dateOfJoining}
              onChange={(e) => setDateOfJoining(e.target.value)}
              className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Workspace Permission Role</label>
            <select
              value={intendedRole}
              onChange={(e) => setIntendedRole(e.target.value as UserRole)}
              className="varta-select w-full px-3.5 py-2 rounded-2xl text-xs"
            >
              <option value="employee">Employee (Standard Access)</option>
              <option value="organizer">Meeting Organizer (Can Schedule & Host)</option>
              <option value="super_admin">Super Admin (Full Org Control)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">LinkedIn Profile (Optional)</label>
            <input
              type="text"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://linkedin.com/in/..."
              className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">X / Twitter URL (Optional)</label>
            <input
              type="text"
              value={twitterUrl}
              onChange={(e) => setTwitterUrl(e.target.value)}
              placeholder="https://x.com/..."
              className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1">Portfolio / Website (Optional)</label>
            <input
              type="text"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://..."
              className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#454A62] mb-1">Short Professional Bio</label>
          <textarea
            rows={2}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Brief professional summary, key responsibilities, and domain focus..."
            className="varta-input w-full px-3.5 py-2 rounded-2xl text-xs"
          />
        </div>

        {!editing && status !== 'inactive' && (
          <div className="p-4 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] space-y-3">
            {!isFoundingSelected && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-[#151722]">Account Password Setup</p>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleSetupModeChange('self_service')}
                    className={`text-left p-3 rounded-2xl border transition-all ${
                      passwordSetupMode === 'self_service'
                        ? 'bg-white border-[#4D4CEF] ring-2 ring-[#4D4CEF]/15 shadow-2xs'
                        : 'bg-white/60 border-[#E2E5F2] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <MailCheck
                        className={`h-4 w-4 ${
                          passwordSetupMode === 'self_service' ? 'text-[#4D4CEF]' : 'text-[#8D92A8]'
                        }`}
                      />
                      <span className="text-xs font-bold text-[#151722]">Employee Generates Own Password</span>
                    </div>
                    <p className="text-[11px] text-[#6E748C] mt-1">
                      Save details now; employee authenticates with Employee ID + Email on /register.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetupModeChange('admin_set')}
                    className={`text-left p-3 rounded-2xl border transition-all ${
                      passwordSetupMode === 'admin_set'
                        ? 'bg-white border-[#4D4CEF] ring-2 ring-[#4D4CEF]/15 shadow-2xs'
                        : 'bg-white/60 border-[#E2E5F2] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ShieldCheck
                        className={`h-4 w-4 ${
                          passwordSetupMode === 'admin_set' ? 'text-[#4D4CEF]' : 'text-[#8D92A8]'
                        }`}
                      />
                      <span className="text-xs font-bold text-[#151722]">Admin Sets Initial Password</span>
                    </div>
                    <p className="text-[11px] text-[#6E748C] mt-1">
                      Create an active login immediately with a custom or generated password.
                    </p>
                  </button>
                </div>
              </div>
            )}

            {!isFoundingSelected && passwordSetupMode === 'self_service' ? (
              <div className="p-3 rounded-2xl bg-white border border-[#E2E5F2] text-xs text-[#454A62] space-y-1">
                <p className="font-semibold text-[#151722]">No password required from Admin</p>
                <p className="text-[11px] text-[#6E748C]">
                  The employee can open <span className="font-semibold text-[#4D4CEF]">Verify ID &amp; Set Password (/register)</span>,
                  authenticate using <span className="font-mono font-bold text-[#151722]">{empCode || 'AIPL-XXX'}</span> and{' '}
                  <span className="font-mono text-[#151722]">{email || 'their official email'}</span>, and create or generate their own password.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-[#151722]">
                    Initial Login Password * (for Active Account Access)
                  </label>
                  <button
                    type="button"
                    onClick={generateTempPassword}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4D4CEF] hover:underline"
                  >
                    <KeyRound className="h-3 w-3" /> Generate Strong Password
                  </button>
                </div>
                <input
                  type="text"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters..."
                  className="varta-input w-full px-3.5 py-2 rounded-2xl font-mono text-xs bg-white"
                />
              </div>
            )}
          </div>
        )}

        {editing && status !== 'inactive' && (
          <div className="p-4 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-[#151722]">
                {!editing.auth_user_id && !isFoundingSelected
                  ? 'Optional: Set Password & Activate Now (otherwise Employee sets own password via /register)'
                  : 'Optional: Change / Generate New Login Password'}
              </label>
              <button
                type="button"
                onClick={generateTempPassword}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4D4CEF] hover:underline shrink-0"
              >
                <KeyRound className="h-3 w-3" /> Generate Strong Password
              </button>
            </div>
            <input
              type="text"
              minLength={password.length > 0 ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep unchanged (min 8 chars to set)..."
              className="varta-input w-full px-3.5 py-2 rounded-2xl font-mono text-xs bg-white"
            />
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-[#F1F3F9] hover:bg-[#E4E7F2] text-xs font-semibold text-[#454A62]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-xs font-semibold text-white"
          >
            {saving
              ? 'Saving...'
              : editing
                ? 'Save Changes'
                : isFoundingSelected
                  ? 'Add Leadership Profile'
                  : status === 'inactive'
                    ? 'Save Employee (Inactive)'
                    : passwordSetupMode === 'admin_set'
                      ? 'Create Active Employee'
                      : 'Save Employee (Self-Setup)'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
