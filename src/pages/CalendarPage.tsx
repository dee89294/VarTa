/**
 * File: src/pages/CalendarPage.tsx
 * Purpose: Enterprise Meeting Calendar styled in Crisp White, Soft Alabaster, Royal Indigo (`#4D4CEF`),
 *   and Orchid Violet featuring Monthly, Weekly, and Daily views with locked meeting events.
 * Why required: Visualizes scheduled, live, completed, and cancelled meetings; enforces locking rules so only
 *   the meeting's Organizer or Super Admin can reschedule or cancel an existing calendar slot.
 * Connected files:
 *   - `src/App.tsx` (route `/calendar`)
 *   - `src/contexts/AuthContext.tsx` (`employee`, `role` determine edit/reschedule/cancel permissions)
 *   - `src/lib/supabase.ts` (reads & updates `meetings`, inserts `notifications`, subscribes to Realtime `meetings`)
 *   - `src/pages/ScheduleMeetingPage.tsx` (creates meetings displayed here)
 *   - `src/pages/LiveMeetingPage.tsx` (launched from event inspector modal)
 * Impact if modified/removed: Users lose calendar visibility and organizers lose reschedule/cancel controls.
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  CalendarDays,
  Users,
  Video,
  Clock,
  Edit3,
  XCircle,
  CalendarPlus,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import { formatDateTime, formatTime } from '../lib/utils'
import { PageTransition } from '../components/ui/MotionPrimitives'
import { MeetingStatusBadge } from '../components/ui/StatusBadge'
import { Modal } from '../components/ui/Modal'
import type { Meeting, MeetingStatus } from '../types/database'

type ViewMode = 'month' | 'week' | 'day'
type StatusFilter = 'all' | 'upcoming' | 'completed' | 'cancelled'

export function CalendarPage() {
  const { employee, role } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [cursorDate, setCursorDate] = useState(() => new Date())

  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null)
  const [rescheduleMode, setRescheduleMode] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [newDuration, setNewDuration] = useState(45)
  const [savingAction, setSavingAction] = useState(false)

  const loadMeetings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select(
          `*,
           organizer:employees!meetings_organizer_id_fkey(id, employee_code, full_name, designation),
           meeting_participants(id, employee_id, admission_status, employee:employees!meeting_participants_employee_id_fkey(id, employee_code, full_name)),
           meeting_agenda(*)`
        )
        .order('scheduled_start', { ascending: true })
      if (error) throw error
      setMeetings((data ?? []) as Meeting[])
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed loading calendar',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadMeetings()
    const ch = supabase
      .channel('calendar-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => loadMeetings())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [loadMeetings])

  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      if (statusFilter === 'upcoming') return m.status === 'scheduled' || m.status === 'live'
      if (statusFilter === 'completed') return m.status === 'completed'
      if (statusFilter === 'cancelled') return m.status === 'cancelled'
      return true
    })
  }, [meetings, statusFilter])

  const canModifySelected = useMemo(() => {
    if (!selectedMeeting || !employee) return false
    if (selectedMeeting.status === 'completed' || selectedMeeting.status === 'cancelled') return false
    return role === 'super_admin' || selectedMeeting.organizer_id === employee.id
  }, [selectedMeeting, employee, role])

  const openInspector = (m: Meeting) => {
    setSelectedMeeting(m)
    const d = new Date(m.scheduled_start)
    const localYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setNewDate(localYmd)
    setNewTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    setNewDuration(m.duration_minutes)
    setRescheduleMode(false)
  }

  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedMeeting) return
    setSavingAction(true)
    try {
      const start = new Date(`${newDate}T${newTime}:00`)
      const end = new Date(start.getTime() + newDuration * 60_000)

      const { error } = await supabase
        .from('meetings')
        .update({
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          duration_minutes: newDuration,
        })
        .eq('id', selectedMeeting.id)

      if (error) throw error

      const invitees = (selectedMeeting.meeting_participants ?? [])
        .map((p) => p.employee_id)
        .filter((eid) => eid !== employee?.id)

      if (invitees.length > 0) {
        await supabase.from('notifications').insert(
          invitees.map((eid) => ({
            recipient_employee_id: eid,
            meeting_id: selectedMeeting.id,
            type: 'meeting_rescheduled',
            title: 'Meeting Rescheduled',
            message: `"${selectedMeeting.title}" was moved to ${formatDateTime(start.toISOString())}.`,
          }))
        )
      }

      toast({ type: 'success', title: 'Meeting Rescheduled', description: 'Calendar updated & invitees notified.' })
      setSelectedMeeting(null)
      loadMeetings()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Reschedule failed',
        description: err instanceof Error ? err.message : 'Calendar conflict or permission error',
      })
    } finally {
      setSavingAction(false)
    }
  }

  const handleCancelMeeting = async () => {
    if (!selectedMeeting) return
    if (!window.confirm(`Cancel "${selectedMeeting.title}"? This will notify all invited participants.`)) return
    setSavingAction(true)
    try {
      const { error } = await supabase
        .from('meetings')
        .update({ status: 'cancelled' as MeetingStatus })
        .eq('id', selectedMeeting.id)
      if (error) throw error

      const invitees = (selectedMeeting.meeting_participants ?? [])
        .map((p) => p.employee_id)
        .filter((eid) => eid !== employee?.id)

      if (invitees.length > 0) {
        await supabase.from('notifications').insert(
          invitees.map((eid) => ({
            recipient_employee_id: eid,
            meeting_id: selectedMeeting.id,
            type: 'meeting_cancelled',
            title: 'Meeting Cancelled',
            message: `"${selectedMeeting.title}" (${selectedMeeting.meeting_code}) has been cancelled.`,
          }))
        )
      }

      toast({ type: 'info', title: 'Meeting Cancelled' })
      setSelectedMeeting(null)
      loadMeetings()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could not cancel meeting',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setSavingAction(false)
    }
  }

  const monthDays = useMemo(() => {
    const year = cursorDate.getFullYear()
    const month = cursorDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const startOffset = firstDay.getDay()
    const gridStart = new Date(year, month, 1 - startOffset)
    return Array.from({ length: 42 }, (_, idx) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + idx)
      return d
    })
  }, [cursorDate])

  const weekDays = useMemo(() => {
    const start = new Date(cursorDate)
    start.setDate(cursorDate.getDate() - cursorDate.getDay())
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [cursorDate])

  const meetingsOnDate = (day: Date) => {
    const y = day.getFullYear()
    const m = day.getMonth()
    const dt = day.getDate()
    return filteredMeetings.filter((mt) => {
      const s = new Date(mt.scheduled_start)
      return s.getFullYear() === y && s.getMonth() === m && s.getDate() === dt
    })
  }

  const shiftPeriod = (dir: -1 | 1) => {
    const d = new Date(cursorDate)
    if (viewMode === 'month') d.setMonth(d.getMonth() + dir)
    else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7)
    else d.setDate(d.getDate() + dir)
    setCursorDate(d)
  }

  const periodLabel =
    viewMode === 'month'
      ? cursorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : viewMode === 'week'
        ? `Week of ${weekDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
        : cursorDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const eventChipStyle = (status: MeetingStatus) => {
    if (status === 'live') return 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
    if (status === 'completed') return 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
    if (status === 'cancelled') return 'bg-[#EFF1F6] border-[#DFE3EE] text-[#8D92A8] line-through'
    return 'bg-[#4D4CEF]/10 border-[#4D4CEF]/25 text-[#3736C9] hover:bg-[#4D4CEF]/15'
  }

  return (
    <PageTransition className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight">Meeting Calendar</h1>
          <p className="text-sm text-[#6E748C] mt-1">
            Locked enterprise schedule. Only each meeting’s Organizer or Super Admin can reschedule or cancel.
          </p>
        </div>

        {(role === 'super_admin' || role === 'organizer') && (
          <button
            onClick={() => navigate('/schedule-meeting')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-[0_10px_22px_-8px_rgba(21,22,28,0.4)]"
          >
            <CalendarPlus className="h-4 w-4" />
            Schedule Locked Event
          </button>
        )}
      </div>

      {/* Controls Bar */}
      <div className="varta-card rounded-[24px] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftPeriod(-1)}
            className="p-2 rounded-full bg-[#F4F5FA] hover:bg-[#E7EAF5] text-[#454A62]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCursorDate(new Date())}
            className="px-3.5 py-1.5 rounded-full bg-[#F4F5FA] hover:bg-[#E7EAF5] text-xs font-semibold text-[#151722]"
          >
            Today
          </button>
          <button
            onClick={() => shiftPeriod(1)}
            className="p-2 rounded-full bg-[#F4F5FA] hover:bg-[#E7EAF5] text-[#454A62]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="font-display text-base sm:text-lg font-bold text-[#151722] ml-2">{periodLabel}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-[#F3F4F9] border border-[#E5E8F2] p-1">
            {(['month', 'week', 'day'] as ViewMode[]).map((vm) => (
              <button
                key={vm}
                onClick={() => setViewMode(vm)}
                className={`px-3.5 py-1 rounded-full text-xs font-semibold capitalize transition-colors ${
                  viewMode === vm ? 'bg-[#4D4CEF] text-white shadow-xs' : 'text-[#666C85] hover:text-[#151722]'
                }`}
              >
                {vm}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="varta-select px-3 py-2 rounded-full text-xs font-medium"
          >
            <option value="all">All Meetings</option>
            <option value="upcoming">Upcoming & Live</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Calendar Views */}
      {loading ? (
        <div className="varta-card rounded-[28px] p-12 text-center text-sm text-[#6E748C]">Loading calendar...</div>
      ) : viewMode === 'month' ? (
        <div className="varta-card rounded-[28px] overflow-hidden">
          <div className="grid grid-cols-7 border-b border-[#EEF0F7] bg-[#F8F9FD] text-center text-[11px] font-bold uppercase tracking-wider text-[#7A8099]">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-3">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 auto-rows-[minmax(115px,auto)] divide-x divide-y divide-[#EEF0F7]">
            {monthDays.map((day) => {
              const isCurrentMonth = day.getMonth() === cursorDate.getMonth()
              const isToday = day.toDateString() === new Date().toDateString()
              const items = meetingsOnDate(day)
              return (
                <div
                  key={day.toISOString()}
                  className={`p-2 transition-colors ${isCurrentMonth ? 'bg-white' : 'bg-[#F8F9FD] opacity-65'}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        isToday ? 'bg-[#4D4CEF] text-white shadow-xs' : 'text-[#5C627A]'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {items.map((mt) => (
                      <button
                        key={mt.id}
                        onClick={() => openInspector(mt)}
                        className={`w-full text-left px-2 py-1 rounded-xl border text-[11px] transition-all ${eventChipStyle(mt.status)}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[10px] font-semibold">{formatTime(mt.scheduled_start)}</span>
                          <Lock className="h-2.5 w-2.5 shrink-0 opacity-75" />
                        </div>
                        <p className="font-bold truncate">{mt.title}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className={`grid gap-4 ${viewMode === 'week' ? 'md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1'}`}>
          {(viewMode === 'week' ? weekDays : [cursorDate]).map((day) => {
            const items = meetingsOnDate(day)
            const isToday = day.toDateString() === new Date().toDateString()
            return (
              <div key={day.toISOString()} className="varta-card rounded-[28px] p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[#EEF0F7]">
                  <p className="text-xs font-bold text-[#151722]">
                    {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {isToday && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#4D4CEF] text-white">Today</span>
                  )}
                </div>

                {items.length === 0 ? (
                  <p className="text-xs text-[#8D92A8] py-4 text-center">No scheduled meetings</p>
                ) : (
                  <div className="space-y-2.5">
                    {items.map((mt) => (
                      <button
                        key={mt.id}
                        onClick={() => openInspector(mt)}
                        className={`w-full text-left p-3 rounded-2xl border transition-all ${eventChipStyle(mt.status)}`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-mono text-[11px] font-semibold">{mt.meeting_code}</span>
                          <Lock className="h-3 w-3 opacity-80" />
                        </div>
                        <p className="text-xs font-bold">{mt.title}</p>
                        <p className="text-[11px] opacity-85 mt-1">
                          {formatTime(mt.scheduled_start)} ({mt.duration_minutes}m) • {mt.organizer?.full_name}
                        </p>
                        <p className="text-[10px] opacity-75 mt-0.5">{mt.meeting_participants?.length ?? 0} invited</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Calendar Event Inspector Modal */}
      <Modal
        open={Boolean(selectedMeeting)}
        onClose={() => setSelectedMeeting(null)}
        title={selectedMeeting?.title || 'Meeting Details'}
        subtitle={`${selectedMeeting?.meeting_code} • Organized by ${selectedMeeting?.organizer?.full_name || 'Organizer'}`}
        maxWidth="max-w-lg"
      >
        {selectedMeeting && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MeetingStatusBadge status={selectedMeeting.status} />
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-[#F4F5FA] border border-[#E5E8F2] text-[#454A62]">
                <Lock className="h-3 w-3 text-[#4D4CEF]" />
                {canModifySelected ? 'Locked (You have edit permission)' : 'Locked Event (Read-only)'}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] space-y-2 text-xs">
              <div className="flex items-center gap-2 text-[#151722] font-semibold">
                <CalendarDays className="h-4 w-4 text-[#4D4CEF]" />
                <span>{formatDateTime(selectedMeeting.scheduled_start)}</span>
              </div>
              <div className="flex items-center gap-2 text-[#5E647B]">
                <Clock className="h-4 w-4 text-[#8D92A8]" />
                <span>Duration: {selectedMeeting.duration_minutes} minutes</span>
              </div>
              <div className="flex items-center gap-2 text-[#5E647B]">
                <Users className="h-4 w-4 text-[#8D92A8]" />
                <span>{selectedMeeting.meeting_participants?.length ?? 0} invited participant(s)</span>
              </div>
              {selectedMeeting.description && (
                <p className="text-[#666C85] pt-2 border-t border-[#E6E8F2]">{selectedMeeting.description}</p>
              )}
            </div>

            {rescheduleMode && canModifySelected ? (
              <form onSubmit={handleReschedule} className="p-4 rounded-2xl bg-[#4D4CEF]/[0.06] border border-[#4D4CEF]/20 space-y-3">
                <p className="text-xs font-bold text-[#151722]">Reschedule Meeting</p>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="varta-input px-2.5 py-2 rounded-xl text-xs bg-white"
                  />
                  <input
                    type="time"
                    required
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="varta-input px-2.5 py-2 rounded-xl text-xs bg-white"
                  />
                  <select
                    value={newDuration}
                    onChange={(e) => setNewDuration(Number(e.target.value))}
                    className="varta-select px-2.5 py-2 rounded-xl text-xs bg-white"
                  >
                    {[15, 30, 45, 60, 90, 120].map((m) => (
                      <option key={m} value={m}>
                        {m}m
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRescheduleMode(false)}
                    className="px-3.5 py-1.5 rounded-full bg-white text-xs font-semibold text-[#454A62] border border-[#E5E8F2]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingAction}
                    className="px-4 py-1.5 rounded-full bg-[#4D4CEF] text-xs font-semibold text-white"
                  >
                    {savingAction ? 'Updating...' : 'Save New Time'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                {canModifySelected && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRescheduleMode(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] text-xs font-semibold text-[#151722]"
                    >
                      <Edit3 className="h-3.5 w-3.5" /> Reschedule
                    </button>
                    <button
                      onClick={handleCancelMeeting}
                      disabled={savingAction}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-semibold text-rose-700"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Cancel Meeting
                    </button>
                  </div>
                )}

                {(selectedMeeting.status === 'scheduled' || selectedMeeting.status === 'live') && (
                  <button
                    onClick={() => {
                      const id = selectedMeeting.id
                      setSelectedMeeting(null)
                      navigate(`/meetings/${id}`)
                    }}
                    className="ml-auto inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white"
                  >
                    <Video className="h-3.5 w-3.5" />
                    {selectedMeeting.status === 'live' ? 'Join Live Call' : 'Open Meeting Room'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </PageTransition>
  )
}
