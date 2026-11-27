/**
 * File: src/components/admin/MeetingManagementPanel.tsx
 * Purpose: Admin Dashboard Meeting Management console showing live, scheduled, completed, and cancelled
 *   company meetings with organizer, department badges, participant counts, quick launch, start/cancel,
 *   and attendance audit report shortcuts.
 * Connected files:
 *   - `src/components/admin/AdminModulesSection.tsx` (embedded inside Super Admin Dashboard)
 *   - `src/pages/ScheduleMeetingPage.tsx`, `LiveMeetingPage.tsx`, `AttendancePage.tsx`, `CalendarPage.tsx`
 *   - `supabase/functions/meeting-access/index.ts` (`start_meeting`)
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, CalendarPlus, ClipboardCheck, Play, Search, Video, XCircle } from 'lucide-react'
import { invokeEdgeFunction, supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'
import { formatDateTime } from '../../lib/utils'
import { Avatar } from '../ui/Avatar'
import { MeetingStatusBadge } from '../ui/StatusBadge'
import type { Department, Meeting, MeetingStatus } from '../../types/database'

interface MeetingManagementPanelProps {
  meetings: Meeting[]
  departments: Department[]
  onChanged: () => void
}

export function MeetingManagementPanel({
  meetings,
  departments,
  onChanged,
}: MeetingManagementPanelProps) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<'all' | MeetingStatus>('all')
  const [deptFilter, setDeptFilter] = useState('')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return meetings.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (
        deptFilter &&
        m.department_id !== deptFilter &&
        !(m.invited_department_ids ?? []).includes(deptFilter)
      ) {
        return false
      }
      if (q) {
        const hay = `${m.meeting_code} ${m.title} ${m.organizer?.full_name ?? ''} ${m.department?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [meetings, statusFilter, deptFilter, search])

  const handleStart = async (meetingId: string) => {
    try {
      await invokeEdgeFunction('meeting-access', { action: 'start_meeting', meeting_id: meetingId })
      toast({ type: 'success', title: 'Meeting Started', description: 'Opening live WebRTC room...' })
      navigate(`/meetings/${meetingId}`)
    } catch (err) {
      toast({
        type: 'error',
        title: 'Unable to start meeting',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleCancel = async (m: Meeting) => {
    if (!window.confirm(`Cancel "${m.title}" (${m.meeting_code})?`)) return
    const { error } = await supabase.from('meetings').update({ status: 'cancelled' }).eq('id', m.id)
    if (error) {
      toast({ type: 'error', title: 'Cancel failed', description: error.message })
    } else {
      toast({ type: 'info', title: 'Meeting Cancelled', description: m.title })
      onChanged()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-[#151722] flex items-center gap-2">
            <Video className="h-5 w-5 text-[#4D4CEF]" />
            Meeting Management
          </h3>
          <p className="text-xs text-[#6E748C]">
            Schedule department/team meetings, launch live rooms, oversee participants, and open attendance reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/calendar')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#E5E8F2] text-xs font-semibold text-[#151722]"
          >
            <CalendarDays className="h-3.5 w-3.5 text-[#4D4CEF]" /> Calendar
          </button>
          <button
            onClick={() => navigate('/schedule-meeting')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white"
          >
            <CalendarPlus className="h-3.5 w-3.5" /> Schedule Meeting
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="lg:col-span-2 relative">
          <Search className="h-3.5 w-3.5 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search meeting code, title, or host..."
            className="varta-input w-full pl-9 pr-3 py-2 rounded-2xl text-xs"
          />
        </div>
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
          onChange={(e) => setStatusFilter(e.target.value as 'all' | MeetingStatus)}
          className="varta-select px-3 py-2 rounded-2xl text-xs"
        >
          <option value="all">All Statuses</option>
          <option value="live">Live Now</option>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="rounded-[24px] border border-[#EAEDF6] overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF0F7] bg-[#F8F9FD] text-[11px] font-bold uppercase tracking-wider text-[#7A8099]">
                <th className="py-3 px-4">Meeting</th>
                <th className="py-3 px-4">Organizer & Dept</th>
                <th className="py-3 px-4">Participants</th>
                <th className="py-3 px-4">Scheduled</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F8] text-xs">
              {filtered.slice(0, 10).map((m) => (
                <tr key={m.id} className="hover:bg-[#F8F9FD] transition-colors">
                  <td className="py-3 px-4">
                    <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EFF1F8] text-[#4D4CEF] border border-[#DFE3F2]">
                      {m.meeting_code}
                    </span>
                    <p className="font-bold text-[#151722] mt-1">{m.title}</p>
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-semibold text-[#151722]">{m.organizer?.full_name || '—'}</p>
                    <p className="text-[11px] text-[#7D839B]">{m.department?.name || 'Cross-Department'}</p>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1.5">
                        {(m.meeting_participants ?? []).slice(0, 3).map((p) => (
                          <Avatar
                            key={p.id}
                            name={p.employee?.full_name || 'Member'}
                            src={p.employee?.avatar_url}
                            size="xs"
                            shape="circle"
                            className="ring-2 ring-white"
                          />
                        ))}
                      </div>
                      <span className="font-semibold text-[#5E647B]">
                        {m.meeting_participants?.length ?? 0} invited
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-[#5E647B]">
                    <p>{formatDateTime(m.scheduled_start)}</p>
                    <p className="text-[10px] text-[#8D92A8]">{m.duration_minutes} mins</p>
                  </td>
                  <td className="py-3 px-4">
                    <MeetingStatusBadge status={m.status} />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {m.status === 'scheduled' && (
                        <button
                          onClick={() => handleStart(m.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-[11px] font-semibold text-white"
                        >
                          <Play className="h-3 w-3" /> Start
                        </button>
                      )}
                      {m.status === 'live' && (
                        <button
                          onClick={() => navigate(`/meetings/${m.id}`)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-700 text-[11px] font-semibold text-white"
                        >
                          Join Room
                        </button>
                      )}
                      {m.status === 'completed' && (
                        <button
                          onClick={() => navigate(`/attendance?meeting=${m.id}`)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold"
                        >
                          <ClipboardCheck className="h-3 w-3" /> Attendance
                        </button>
                      )}
                      {(m.status === 'scheduled' || m.status === 'live') && (
                        <button
                          onClick={() => handleCancel(m)}
                          title="Cancel Meeting"
                          className="p-1.5 rounded-full bg-[#F4F5FA] hover:bg-rose-50 text-[#666C85] hover:text-rose-600"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-[#8D92A8]">
                    No meetings match your filter.
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
