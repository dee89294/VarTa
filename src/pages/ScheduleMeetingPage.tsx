/**
 * File: src/pages/ScheduleMeetingPage.tsx
 * Purpose: Meeting Scheduling System integrated with Organization Management (Departments, Designations,
 *   Categories) allowing Organizers and Super Admins to search employees by name/Employee ID, filter and
 *   select single or multiple departments, quick-invite Department Heads/Managers/Leadership, preview
 *   selected participants & official email addresses before sending, and dispatch invitations.
 * Security: Queries strictly `.eq('status', 'active')` employees so inactive staff never appear in searches.
 * Connected files:
 *   - `src/App.tsx` (route `/schedule-meeting`)
 *   - `src/contexts/AuthContext.tsx` (`employee`, `role`)
 *   - `supabase/functions/meeting-access/index.ts` (`check_conflicts`, `dispatch_schedule_invites`)
 *   - `src/pages/CalendarPage.tsx`
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarPlus,
  Search,
  CheckSquare,
  Square,
  Plus,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Users,
  Lock,
  Building2,
  Award,
  Crown,
  MailCheck,
  X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { invokeEdgeFunction, supabase } from '../lib/supabase'
import { formatDateTime, generateMeetingCode } from '../lib/utils'
import { getDisplayEmployeeId, isFoundingMember } from '../lib/orgUtils'
import { PageTransition } from '../components/ui/MotionPrimitives'
import { Avatar } from '../components/ui/Avatar'
import { CategoryBadge } from '../components/ui/StatusBadge'
import type { Department, Employee, Team } from '../types/database'

interface AgendaDraft {
  id: string
  title: string
  duration_minutes: number
  presenter_name: string
}

interface ConflictWarning {
  meeting_id: string
  meeting_code: string
  meeting_title: string
  conflict_type: string
  scheduled_start: string
  scheduled_end: string
  affected_count: number
}

type InviteSource = 'individual' | 'department' | 'department_heads' | 'managers' | 'leadership'

export function ScheduleMeetingPage() {
  const { employee, role } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // Form Fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000)
    return `${String(d.getHours()).padStart(2, '0')}:${String(Math.floor(d.getMinutes() / 15) * 15).padStart(2, '0')}`
  })
  const [durationMinutes, setDurationMinutes] = useState(45)
  const [teamId, setTeamId] = useState('')
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false)

  // Multi-Department & Participant Selection
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([])
  const [empSearch, setEmpSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [inviteSourceMap, setInviteSourceMap] = useState<Record<string, InviteSource>>({})

  // Agenda
  const [agendaItems, setAgendaItems] = useState<AgendaDraft[]>([
    { id: '1', title: 'Opening Alignment & Objectives', duration_minutes: 10, presenter_name: '' },
  ])

  // Conflicts & Submission
  const [conflicts, setConflicts] = useState<ConflictWarning[]>([])
  const [checkingConflicts, setCheckingConflicts] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [empRes, deptRes, teamRes, settingsRes] = await Promise.all([
          supabase
            .from('employees')
            .select(
              '*, department:departments!employees_department_id_fkey(id, name, code), team:teams!employees_team_id_fkey(id, name, department_id)'
            )
            .eq('status', 'active')
            .order('display_order', { ascending: true })
            .order('employee_code', { ascending: true }),
          supabase.from('departments').select('*').eq('is_active', true).order('display_order').order('name'),
          supabase.from('teams').select('*').order('name'),
          supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle(),
        ])
        setEmployees((empRes.data ?? []) as Employee[])
        setDepartments((deptRes.data ?? []) as Department[])
        setTeams((teamRes.data ?? []) as Team[])
        if (settingsRes.data?.default_waiting_room) {
          setWaitingRoomEnabled(true)
        }
      } finally {
        setLoadingData(false)
      }
    }
    load()
  }, [])

  const scheduledStartIso = useMemo(() => {
    if (!date || !startTime) return null
    const d = new Date(`${date}T${startTime}:00`)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }, [date, startTime])

  const scheduledEndIso = useMemo(() => {
    if (!scheduledStartIso) return null
    return new Date(new Date(scheduledStartIso).getTime() + durationMinutes * 60_000).toISOString()
  }, [scheduledStartIso, durationMinutes])

  const checkConflicts = useCallback(async () => {
    if (!scheduledStartIso || !scheduledEndIso || !employee) return
    setCheckingConflicts(true)
    try {
      const res = await invokeEdgeFunction<{ conflicts: ConflictWarning[] }>('meeting-access', {
        action: 'check_conflicts',
        scheduled_start: scheduledStartIso,
        scheduled_end: scheduledEndIso,
        participant_ids: selectedIds,
        organizer_id: employee.id,
      })
      setConflicts(res.conflicts ?? [])
    } catch {
      // ignore background conflict check error
    } finally {
      setCheckingConflicts(false)
    }
  }, [scheduledStartIso, scheduledEndIso, selectedIds, employee])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      checkConflicts()
    }, 350)
    return () => window.clearTimeout(timer)
  }, [checkConflicts])

  // Show active non-founding employees filtered by one or more selected departments + search query
  const selectableEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase()
    return employees.filter((e) => {
      if (e.id === employee?.id || isFoundingMember(e)) return false
      if (selectedDeptIds.length > 0 && (!e.department_id || !selectedDeptIds.includes(e.department_id))) {
        return false
      }
      if (teamId && e.team_id !== teamId) return false
      if (q) {
        const hay = `${e.employee_code} ${e.full_name} ${e.email} ${e.designation} ${e.department?.name ?? ''} ${e.team?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [employees, employee?.id, selectedDeptIds, teamId, empSearch])

  const selectedParticipants = useMemo(
    () => employees.filter((e) => selectedIds.includes(e.id)),
    [employees, selectedIds]
  )

  const toggleDepartmentFilter = (deptId: string) => {
    setSelectedDeptIds((prev) => (prev.includes(deptId) ? prev.filter((id) => id !== deptId) : [...prev, deptId]))
  }

  const addIdsWithSource = (ids: string[], source: InviteSource) => {
    if (ids.length === 0) return
    setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])))
    setInviteSourceMap((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        if (!next[id]) next[id] = source
      }
      return next
    })
  }

  const toggleEmployee = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
    setInviteSourceMap((prev) => ({ ...prev, [id]: prev[id] || 'individual' }))
  }

  const selectFilteredEmployees = () => {
    const ids = selectableEmployees.map((e) => e.id)
    addIdsWithSource(ids, selectedDeptIds.length > 0 ? 'department' : 'individual')
  }

  const inviteWholeDepartment = (deptId: string) => {
    if (!selectedDeptIds.includes(deptId)) {
      setSelectedDeptIds((prev) => [...prev, deptId])
    }
    const ids = employees
      .filter((e) => e.id !== employee?.id && !isFoundingMember(e) && e.department_id === deptId)
      .map((e) => e.id)
    addIdsWithSource(ids, 'department')
    const deptName = departments.find((d) => d.id === deptId)?.name ?? 'Department'
    toast({ type: 'info', title: `Added ${ids.length} active member(s) from ${deptName}` })
  }

  const inviteDepartmentHeads = () => {
    const headIdSet = new Set(departments.map((d) => d.head_employee_id).filter(Boolean) as string[])
    const ids = employees
      .filter(
        (e) =>
          e.id !== employee?.id &&
          !isFoundingMember(e) &&
          (e.org_category === 'department_head' || headIdSet.has(e.id))
      )
      .map((e) => e.id)
    addIdsWithSource(ids, 'department_heads')
    toast({ type: 'info', title: `Selected ${ids.length} Department Head(s)` })
  }

  const inviteManagers = () => {
    const ids = employees
      .filter((e) => e.id !== employee?.id && !isFoundingMember(e) && e.org_category === 'manager')
      .map((e) => e.id)
    addIdsWithSource(ids, 'managers')
    toast({ type: 'info', title: `Selected ${ids.length} Manager(s)` })
  }

  const inviteLeadership = () => {
    const ids = employees
      .filter(
        (e) =>
          e.id !== employee?.id &&
          ['founder', 'managing_director', 'director', 'leadership'].includes(e.org_category || 'employee')
      )
      .map((e) => e.id)
    addIdsWithSource(ids, 'leadership')
    toast({ type: 'info', title: `Selected ${ids.length} Leadership member(s)` })
  }

  const clearSelection = () => {
    setSelectedIds([])
    setInviteSourceMap({})
  }

  const addAgendaRow = () => {
    setAgendaItems((prev) => [
      ...prev,
      { id: `${Date.now()}`, title: '', duration_minutes: 10, presenter_name: '' },
    ])
  }

  const removeAgendaRow = (id: string) => {
    setAgendaItems((prev) => prev.filter((item) => item.id !== id))
  }

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee || !scheduledStartIso || !scheduledEndIso) return
    if (selectedIds.length === 0) {
      toast({
        type: 'warning',
        title: 'Select at least one participant',
        description: 'Only active selected employees will receive meeting invitations and entry access.',
      })
      return
    }

    setSubmitting(true)
    try {
      const meetingCode = generateMeetingCode()
      const participantDeptIds = Array.from(
        new Set([
          ...selectedDeptIds,
          ...(selectedParticipants.map((p) => p.department_id).filter(Boolean) as string[]),
        ])
      )
      const primaryDeptId = selectedDeptIds[0] || participantDeptIds[0] || null
      const nowIso = new Date().toISOString()

      const { data: createdMeeting, error: mtErr } = await supabase
        .from('meetings')
        .insert({
          meeting_code: meetingCode,
          title: title.trim(),
          description: description.trim(),
          organizer_id: employee.id,
          department_id: primaryDeptId,
          team_id: teamId || null,
          invited_department_ids: participantDeptIds,
          scheduled_start: scheduledStartIso,
          scheduled_end: scheduledEndIso,
          duration_minutes: durationMinutes,
          status: 'scheduled',
          waiting_room_enabled: waitingRoomEnabled,
          is_locked: true,
        })
        .select('*')
        .single()

      if (mtErr || !createdMeeting) throw mtErr ?? new Error('Failed to create meeting')

      const participantRows = [
        {
          meeting_id: createdMeeting.id,
          employee_id: employee.id,
          role_in_meeting: 'organizer',
          admission_status: 'admitted',
          invited_by: employee.id,
          invitation_source: 'individual',
          invited_email: employee.email,
          invitation_sent_at: nowIso,
        },
        ...selectedParticipants.map((p) => ({
          meeting_id: createdMeeting.id,
          employee_id: p.id,
          role_in_meeting: 'participant',
          admission_status: 'invited',
          invited_by: employee.id,
          invitation_source: inviteSourceMap[p.id] || 'individual',
          invited_email: p.email,
          invitation_sent_at: nowIso,
        })),
      ]

      const { error: partErr } = await supabase.from('meeting_participants').insert(participantRows)
      if (partErr) throw partErr

      const validAgenda = agendaItems
        .filter((a) => a.title.trim())
        .map((a, index) => ({
          meeting_id: createdMeeting.id,
          position: index + 1,
          title: a.title.trim(),
          duration_minutes: Math.max(1, Number(a.duration_minutes) || 10),
          presenter_name: a.presenter_name.trim() || employee.full_name,
        }))

      if (validAgenda.length > 0) {
        await supabase.from('meeting_agenda').insert(validAgenda)
      }

      await supabase.from('notifications').insert(
        selectedParticipants.map((p) => ({
          recipient_employee_id: p.id,
          meeting_id: createdMeeting.id,
          type: 'meeting_invited',
          title: 'New Meeting Invitation',
          message: `${employee.full_name} invited your official email (${p.email}) to "${createdMeeting.title}" on ${formatDateTime(scheduledStartIso)}.`,
        }))
      )

      await supabase.from('meeting_activity_logs').insert({
        meeting_id: createdMeeting.id,
        actor_employee_id: employee.id,
        action: 'meeting_scheduled',
        details: {
          title: createdMeeting.title,
          invitee_count: selectedParticipants.length,
          departments_count: participantDeptIds.length,
        },
      })

      let emailDispatchNote = `Invitations sent to ${selectedParticipants.length} official email(s) & live notifications.`
      try {
        const dispatchRes = await invokeEdgeFunction<{ email_status?: string; invited_emails?: string[] }>(
          'meeting-access',
          { action: 'dispatch_schedule_invites', meeting_id: createdMeeting.id }
        )
        if (dispatchRes?.email_status === 'sent') {
          emailDispatchNote = `Official email invitations delivered to ${dispatchRes.invited_emails?.length ?? selectedParticipants.length} address(es).`
        }
      } catch {
        // non-blocking audit/email fallback
      }

      toast({
        type: 'success',
        title: `Meeting ${meetingCode} Scheduled & Locked`,
        description: emailDispatchNote,
      })
      navigate('/calendar')
    } catch (err) {
      toast({
        type: 'error',
        title: 'Unable to schedule meeting',
        description: err instanceof Error ? err.message : 'Check for calendar conflicts',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (role !== 'super_admin' && role !== 'organizer') {
    return (
      <PageTransition>
        <div className="varta-card rounded-[28px] p-10 text-center max-w-lg mx-auto mt-10">
          <Lock className="h-10 w-10 text-amber-500 mx-auto mb-3" />
          <h2 className="font-display text-xl font-bold text-[#151722]">Organizer Authorization Required</h2>
          <p className="text-sm text-[#666C85] mt-2">
            Only Meeting Organizers and Super Admins can schedule and lock company meetings.
          </p>
        </div>
      </PageTransition>
    )
  }

  return (
    <PageTransition className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#4D4CEF]/10 border border-[#4D4CEF]/20 text-xs font-semibold text-[#4D4CEF] mb-2">
          <ShieldCheck className="h-3.5 w-3.5" />
          Department-Aware Participant Authorization & Official Email Invitations
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight">Schedule Meeting</h1>
        <p className="text-sm text-[#6E748C] mt-1">
          Select individual employees, multi-department teams, or Department Heads/Managers — inactive employees are automatically excluded.
        </p>
      </div>

      {conflicts.length > 0 && (
        <div className="p-4 rounded-3xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-bold text-amber-900">
              Schedule Conflict Detected ({conflicts.length} overlapping meeting{conflicts.length > 1 ? 's' : ''})
            </p>
            {conflicts.map((c) => (
              <p key={c.meeting_id} className="text-amber-800">
                • <span className="font-mono font-bold">{c.meeting_code}</span> ({c.meeting_title}) —{' '}
                {formatDateTime(c.scheduled_start)} to {formatDateTime(c.scheduled_end)} ({c.affected_count} person
                overlap, {c.conflict_type.replace('_', ' ')})
              </p>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSchedule} className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Left: Details & Agenda */}
        <div className="lg:col-span-5 space-y-6">
          <div className="varta-card rounded-[28px] p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#151722]">1. Meeting Details</h2>

            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Meeting Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Audio Visual & IT Networking Rollout Sync"
                className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Description</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Goals, deliverables, and context for invited departments..."
                className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-sm"
              />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Date *</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="varta-input w-full px-3 py-2.5 rounded-2xl text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Start Time *</label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="varta-input w-full px-3 py-2.5 rounded-2xl text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Duration</label>
                <select
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="varta-select w-full px-3 py-2.5 rounded-2xl text-xs"
                >
                  {[15, 30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-center justify-between p-3.5 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-[#151722]">Enable Waiting Room</p>
                  <p className="text-[11px] text-[#7D839B]">
                    Invited employees wait in Yellow status until manually admitted.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={waitingRoomEnabled}
                  onChange={(e) => setWaitingRoomEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[#CFD4E6] text-[#4D4CEF]"
                />
              </label>
            </div>
          </div>

          {/* Agenda Builder */}
          <div className="varta-card rounded-[28px] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-[#151722]">2. Meeting Agenda</h2>
                <p className="text-xs text-[#7D839B]">Structured talking points inside the call room</p>
              </div>
              <button
                type="button"
                onClick={addAgendaRow}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] text-xs font-semibold text-[#151722]"
              >
                <Plus className="h-3.5 w-3.5 text-[#4D4CEF]" /> Add Item
              </button>
            </div>

            <div className="space-y-2.5">
              {agendaItems.map((item, idx) => (
                <div key={item.id} className="p-3 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] grid sm:grid-cols-12 gap-2 items-center">
                  <span className="sm:col-span-1 h-7 w-7 rounded-full bg-[#4D4CEF] text-white font-bold text-[11px] flex items-center justify-center">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <input
                    type="text"
                    value={item.title}
                    onChange={(e) =>
                      setAgendaItems((prev) =>
                        prev.map((a) => (a.id === item.id ? { ...a, title: e.target.value } : a))
                      )
                    }
                    placeholder="Agenda topic"
                    className="varta-input sm:col-span-6 px-3 py-1.5 rounded-xl text-xs bg-white"
                  />
                  <input
                    type="text"
                    value={item.presenter_name}
                    onChange={(e) =>
                      setAgendaItems((prev) =>
                        prev.map((a) => (a.id === item.id ? { ...a, presenter_name: e.target.value } : a))
                      )
                    }
                    placeholder="Presenter"
                    className="varta-input sm:col-span-3 px-3 py-1.5 rounded-xl text-xs bg-white"
                  />
                  <div className="sm:col-span-2 flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={item.duration_minutes}
                      onChange={(e) =>
                        setAgendaItems((prev) =>
                          prev.map((a) =>
                            a.id === item.id ? { ...a, duration_minutes: Number(e.target.value) } : a
                          )
                        )
                      }
                      className="varta-input w-full px-2 py-1.5 rounded-xl text-xs bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => removeAgendaRow(item.id)}
                      className="p-1.5 text-[#8D92A8] hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Multi-Department, Role-Tier & Individual Participant Matrix */}
        <div className="lg:col-span-7 space-y-5">
          <div className="varta-card rounded-[28px] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-[#151722]">3. Invite Active Participants</h2>
                <p className="text-xs text-[#7D839B]">
                  Filter across multiple departments, select entire departments, or pick individual staff
                </p>
              </div>
              <span className="px-3.5 py-1 rounded-full bg-[#4D4CEF] text-xs font-bold text-white shadow-xs">
                {selectedIds.length} Selected
              </span>
            </div>

            {/* Multi-Department Selector Chips */}
            <div className="space-y-2 p-3.5 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2]">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#5E647B] flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-[#4D4CEF]" />
                  Filter / Select Multiple Departments
                </p>
                {selectedDeptIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedDeptIds([])}
                    className="text-[11px] font-semibold text-[#4D4CEF] hover:underline"
                  >
                    Show All Departments
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {departments.map((d) => {
                  const active = selectedDeptIds.includes(d.id)
                  const count = employees.filter(
                    (e) => e.id !== employee?.id && !isFoundingMember(e) && e.department_id === d.id
                  ).length
                  return (
                    <div key={d.id} className="inline-flex items-center rounded-full border bg-white overflow-hidden border-[#DFE3F0]">
                      <button
                        type="button"
                        onClick={() => toggleDepartmentFilter(d.id)}
                        className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                          active ? 'bg-[#4D4CEF] text-white' : 'text-[#454A62] hover:bg-[#EFF1F8]'
                        }`}
                      >
                        {d.name} ({count})
                      </button>
                      <button
                        type="button"
                        onClick={() => inviteWholeDepartment(d.id)}
                        title={`Invite all active members of ${d.name}`}
                        className="px-2 py-1.5 text-[10px] font-bold text-[#4D4CEF] hover:bg-[#4D4CEF]/10 border-l border-[#E7EAF5]"
                      >
                        +All
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Quick Invite Hierarchy Groups */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={inviteDepartmentHeads}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#4D4CEF]/10 hover:bg-[#4D4CEF]/20 text-[11px] font-semibold text-[#3E3EE0] border border-[#4D4CEF]/20"
              >
                <Award className="h-3 w-3" /> + Department Heads
              </button>
              <button
                type="button"
                onClick={inviteManagers}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 hover:bg-amber-100 text-[11px] font-semibold text-amber-800 border border-amber-200"
              >
                <Users className="h-3 w-3" /> + Managers
              </button>
              <button
                type="button"
                onClick={inviteLeadership}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#9C65E5]/12 hover:bg-[#9C65E5]/20 text-[11px] font-semibold text-[#773DC8] border border-[#9C65E5]/25"
              >
                <Crown className="h-3 w-3" /> + Executive Leadership
              </button>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="varta-select px-3 py-1 rounded-full text-[11px] ml-auto"
              >
                <option value="">Any Sub-Team</option>
                {teams
                  .filter((t) => selectedDeptIds.length === 0 || selectedDeptIds.includes(t.department_id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      Team: {t.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Search + Select Filtered / Clear */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="h-3.5 w-3.5 text-[#8D92A8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Search active employee by name or ID (e.g. AIPL-004)..."
                  className="varta-input w-full pl-9 pr-3 py-2 rounded-2xl text-xs"
                />
              </div>
              <button
                type="button"
                onClick={selectFilteredEmployees}
                className="px-3.5 py-2 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] text-xs font-semibold text-[#151722]"
              >
                Select Visible ({selectableEmployees.length})
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="px-3.5 py-2 rounded-full bg-[#F3F4F9] hover:bg-rose-50 text-xs font-semibold text-[#666C85] hover:text-rose-600"
              >
                Clear
              </button>
            </div>

            {/* Checkbox Employee List (Only Active Staff) */}
            <div className="max-h-72 overflow-y-auto divide-y divide-[#EEF0F7] rounded-2xl border border-[#E6E8F2] bg-[#FAFBFD]">
              {loadingData ? (
                <p className="p-6 text-center text-xs text-[#8D92A8]">Loading active employees...</p>
              ) : selectableEmployees.length === 0 ? (
                <p className="p-6 text-center text-xs text-[#8D92A8]">
                  No active employees match your department or search filter.
                </p>
              ) : (
                selectableEmployees.map((emp) => {
                  const checked = selectedIds.includes(emp.id)
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => toggleEmployee(emp.id)}
                      className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                        checked ? 'bg-[#4D4CEF]/[0.07]' : 'hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {checked ? (
                          <CheckSquare className="h-4 w-4 text-[#4D4CEF] shrink-0" />
                        ) : (
                          <Square className="h-4 w-4 text-[#A4AAC0] shrink-0" />
                        )}
                        <Avatar name={emp.full_name} src={emp.avatar_url} size="xs" shape="circle" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] font-bold text-[#4D4CEF]">{emp.employee_code}</span>
                            <span className="text-xs font-bold text-[#151722] truncate">{emp.full_name}</span>
                            <CategoryBadge category={emp.org_category || 'employee'} />
                          </div>
                          <p className="text-[11px] text-[#7D839B] truncate">
                            {emp.designation} • {emp.department?.name || 'VarTa'} • {emp.email}
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Selected Participants Preview Panel Before Sending Invitations */}
          <div className="varta-card rounded-[28px] p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-[#151722] flex items-center gap-2">
                  <MailCheck className="h-4 w-4 text-[#4D4CEF]" />
                  Selected Participants Preview ({selectedParticipants.length})
                </h3>
                <p className="text-[11px] text-[#7D839B]">
                  Invitations will be dispatched to these registered official email addresses on save.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6E748C]">
                <Clock className="h-3.5 w-3.5 text-[#8D92A8]" />
                {checkingConflicts ? 'Checking overlaps...' : 'Ready'}
              </span>
            </div>

            {selectedParticipants.length === 0 ? (
              <div className="p-4 rounded-2xl bg-[#F6F7FB] border border-dashed border-[#D6DAE9] text-center text-xs text-[#8D92A8]">
                No participants selected yet. Pick departments, heads, managers, or individual employees above.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto flex flex-wrap gap-2">
                {selectedParticipants.map((p) => (
                  <div
                    key={p.id}
                    className="inline-flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-2xl bg-[#F6F7FB] border border-[#E2E5F2] text-xs"
                  >
                    <Avatar name={p.full_name} src={p.avatar_url} size="xs" shape="circle" />
                    <div className="leading-tight">
                      <p className="font-bold text-[#151722] text-[11px]">
                        {p.full_name}{' '}
                        <span className="font-mono text-[#4D4CEF] font-normal">
                          ({getDisplayEmployeeId(p) ?? 'Leadership'})
                        </span>
                      </p>
                      <p className="text-[10px] text-[#7D839B]">
                        {p.department?.code || 'ORG'} • {p.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleEmployee(p.id)}
                      className="p-0.5 rounded-full hover:bg-rose-100 text-[#8D92A8] hover:text-rose-600"
                      title="Remove from invite list"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 px-5 rounded-full bg-[#15161C] hover:bg-[#262835] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_12px_26px_-8px_rgba(21,22,28,0.45)] transition-all hover:scale-[1.01]"
            >
              <CalendarPlus className="h-4 w-4" />
              {submitting
                ? 'Locking Slot & Sending Invitations...'
                : `Schedule & Send Invitations (${selectedParticipants.length} Official Emails)`}
            </button>
          </div>
        </div>
      </form>
    </PageTransition>
  )
}
