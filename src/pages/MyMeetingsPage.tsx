/**
 * File: src/pages/MyMeetingsPage.tsx
 * Purpose: Lists authorized meetings for the logged-in user (serves both `/my-meetings` and `/live-meetings`)
 *   styled in Crisp White, Soft Alabaster, Royal Indigo, and Orchid Violet accents.
 * Why required: Allows employees to join invited live/upcoming meetings and allows organizers/admins to
 *   start scheduled meetings, copy invite links, or jump straight to completed attendance reports.
 * Connected files:
 *   - `src/App.tsx` (`/my-meetings` and `/live-meetings` with `liveOnly`)
 *   - `src/contexts/AuthContext.tsx` (`employee`, `role`)
 *   - `src/lib/supabase.ts` (queries `meetings` under RLS, subscribes to Realtime `meetings`, calls `meeting-access` `start_meeting`)
 *   - `supabase/functions/meeting-access/index.ts` (transitions meeting `'scheduled' -> 'live'` & seeds absent rows)
 *   - `src/pages/LiveMeetingPage.tsx` (`/meetings/:id`) & `src/pages/AttendancePage.tsx` (`/attendance?meeting=:id`)
 * Impact if modified/removed: Users cannot browse their assigned meetings or start/join calls from the list view.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Video, Radio, Clock, Users, Play, Copy, Search, CalendarPlus, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { invokeEdgeFunction, supabase } from '../lib/supabase'
import { formatDateTime } from '../lib/utils'
import { Avatar } from '../components/ui/Avatar'
import { PageTransition, StaggerGrid, StaggerItem } from '../components/ui/MotionPrimitives'
import { MeetingStatusBadge } from '../components/ui/StatusBadge'
import type { Meeting, MeetingStatus } from '../types/database'

export function MyMeetingsPage({ liveOnly = false }: { liveOnly?: boolean }) {
  const { employee, role } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [statusTab, setStatusTab] = useState<'all' | MeetingStatus>(liveOnly ? 'live' : 'all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (liveOnly) setStatusTab('live')
  }, [liveOnly])

  const loadMeetings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('meetings')
        .select(
          `*,
           organizer:employees!meetings_organizer_id_fkey(id, employee_code, full_name, designation),
           department:departments(id, name, code),
           meeting_participants(id, employee_id, admission_status, employee:employees!meeting_participants_employee_id_fkey(id, employee_code, full_name, avatar_url, designation, department:departments!employees_department_id_fkey(name)))`
        )
        .order('scheduled_start', { ascending: false })
      if (error) throw error
      setMeetings((data ?? []) as Meeting[])
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed loading meetings',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadMeetings()
    const ch = supabase
      .channel('my-meetings-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => loadMeetings())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [loadMeetings])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return meetings.filter((m) => {
      if (statusTab !== 'all' && m.status !== statusTab) return false
      if (q) {
        const hay = `${m.title} ${m.meeting_code} ${m.organizer?.full_name ?? ''} ${m.description}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [meetings, statusTab, search])

  const handleStartNow = async (meetingId: string) => {
    try {
      await invokeEdgeFunction('meeting-access', {
        action: 'start_meeting',
        meeting_id: meetingId,
      })
      toast({ type: 'success', title: 'Meeting Started', description: 'Entering live WebRTC room...' })
      navigate(`/meetings/${meetingId}`)
    } catch (err) {
      toast({
        type: 'error',
        title: 'Unable to start meeting',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const copyMeetingLink = (meetingId: string) => {
    const url = `${window.location.origin}/meetings/${meetingId}`
    navigator.clipboard.writeText(url)
    toast({
      type: 'info',
      title: 'Meeting Link Copied',
      description: 'Only invited employees and the organizer can pass entry authorization.',
    })
  }

  const handleCancelMeeting = async (meetingId: string, title: string) => {
    if (!window.confirm(`Are you sure you want to cancel scheduled meeting "${title}"? All invited participants will be notified.`)) return
    try {
      try {
        await invokeEdgeFunction('meeting-access', {
          action: 'cancel_meeting',
          meeting_id: meetingId,
        })
      } catch {
        const { error } = await supabase.from('meetings').update({ status: 'cancelled' }).eq('id', meetingId)
        if (error) throw error
      }
      toast({
        type: 'info',
        title: 'Meeting Cancelled',
        description: `"${title}" has been marked as cancelled.`,
      })
      await loadMeetings()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed to cancel meeting',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  const handleDeleteMeeting = async (meetingId: string, title: string) => {
    if (!window.confirm(`Permanently remove meeting "${title}"? This will delete all attendance and chat records for this meeting.`)) return
    try {
      const { error } = await supabase.from('meetings').delete().eq('id', meetingId)
      if (error) throw error
      toast({
        type: 'success',
        title: 'Meeting Removed',
        description: `"${title}" has been permanently deleted from workspace records.`,
      })
      await loadMeetings()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed to delete meeting',
        description: err instanceof Error ? err.message : 'Error',
      })
    }
  }

  return (
    <PageTransition className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight flex items-center gap-2.5">
            {liveOnly && <Radio className="h-6 w-6 text-rose-500 animate-pulse" />}
            {liveOnly ? 'Live Meetings' : 'My Meetings'}
          </h1>
          <p className="text-sm text-[#6E748C] mt-1">
            {liveOnly
              ? 'Active video conferencing rooms currently in progress.'
              : 'All authorized meetings assigned to you or organized by your account.'}
          </p>
        </div>

        {(role === 'super_admin' || role === 'organizer') && (
          <button
            onClick={() => navigate('/schedule-meeting')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white shadow-[0_10px_22px_-8px_rgba(21,22,28,0.4)]"
          >
            <CalendarPlus className="h-4 w-4" />
            Schedule Meeting
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="varta-card rounded-[24px] p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'live', 'scheduled', 'completed', 'cancelled'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusTab(tab)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize transition-all ${
                statusTab === tab
                  ? 'bg-[#4D4CEF] text-white shadow-xs'
                  : 'bg-[#F4F5FA] text-[#5E647B] hover:text-[#151722]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="h-3.5 w-3.5 text-[#8D92A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, code, organizer..."
            className="varta-input w-full pl-9 pr-3 py-2 rounded-full text-xs"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="varta-card rounded-[28px] h-52 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="varta-card rounded-[28px] p-12 text-center text-sm text-[#6E748C]">
          No meetings match this view.
        </div>
      ) : (
        <StaggerGrid className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((m) => {
            const isHost = m.organizer_id === employee?.id || role === 'super_admin'
            return (
              <StaggerItem key={m.id}>
                <motion.div
                  whileHover={{ y: -3 }}
                  className="varta-card varta-card-hover rounded-[28px] p-5 flex flex-col justify-between h-full gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#EFF1F8] text-[#4D4CEF] border border-[#DFE3F2]">
                        {m.meeting_code}
                      </span>
                      <MeetingStatusBadge status={m.status} />
                    </div>

                    <div>
                      <h3 className="font-display text-base font-bold text-[#151722] leading-snug">{m.title}</h3>
                      <p className="text-xs text-[#6E748C] mt-1 line-clamp-2">
                        {m.description || 'Enterprise scheduled meeting session.'}
                      </p>
                    </div>

                    <div className="space-y-1.5 text-xs text-[#666C85] pt-1">
                      <p className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-[#8D92A8]" />
                        {formatDateTime(m.scheduled_start)} ({m.duration_minutes}m)
                      </p>
                      <p className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-[#8D92A8]" />
                        Host: <span className="text-[#151722] font-semibold">{m.organizer?.full_name}</span> •{' '}
                        {m.meeting_participants?.length ?? 0} invited
                      </p>
                      {(m.meeting_participants ?? []).length > 0 && (
                        <div className="flex items-center gap-2 pt-1">
                          <div className="flex -space-x-1.5">
                            {(m.meeting_participants ?? []).slice(0, 4).map((p) => (
                              <Avatar
                                key={p.id}
                                name={p.employee?.full_name || 'Colleague'}
                                src={p.employee?.avatar_url}
                                size="xs"
                                shape="circle"
                                className="ring-2 ring-white"
                              />
                            ))}
                          </div>
                          <span className="text-[11px] text-[#7D839B] truncate">
                            {(m.meeting_participants ?? [])
                              .map((p) => p.employee?.full_name?.split(' ')[0])
                              .filter(Boolean)
                              .slice(0, 3)
                              .join(', ')}
                            {(m.meeting_participants?.length ?? 0) > 3
                              ? ` +${(m.meeting_participants?.length ?? 0) - 3}`
                              : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#EEF0F7] flex items-center justify-between gap-2">
                    <button
                      onClick={() => copyMeetingLink(m.id)}
                      className="p-2.5 rounded-full bg-[#F4F5FA] hover:bg-[#E7EAF5] text-[#5E647B] hover:text-[#151722] transition-colors"
                      title="Copy invite link"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>

                    {m.status === 'live' ? (
                      <button
                        onClick={() => navigate(`/meetings/${m.id}`)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-md shadow-emerald-600/20"
                      >
                        <Video className="h-3.5 w-3.5" /> Join Live Meeting
                      </button>
                    ) : m.status === 'scheduled' ? (
                      isHost ? (
                        <div className="flex-1 flex items-center gap-1.5">
                          <button
                            onClick={() => handleStartNow(m.id)}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-xs font-semibold text-white shadow-sm"
                          >
                            <Play className="h-3.5 w-3.5" /> Start Call
                          </button>
                          <button
                            onClick={() => navigate(`/meetings/${m.id}`)}
                            className="px-3 py-2 rounded-full bg-[#F1F3F9] hover:bg-[#E4E7F2] text-xs font-semibold text-[#151722]"
                            title="Enter Waiting Room"
                          >
                            Room
                          </button>
                          <button
                            onClick={() => handleCancelMeeting(m.id, m.title)}
                            className="p-2 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 transition-colors"
                            title="Cancel Scheduled Meeting"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteMeeting(m.id, m.title)}
                            className="p-2 rounded-full bg-gray-100 hover:bg-rose-50 hover:text-rose-600 text-gray-500 transition-colors"
                            title="Delete / Remove Meeting"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => navigate(`/meetings/${m.id}`)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3E3EE0] text-xs font-semibold text-white"
                        >
                          <Video className="h-3.5 w-3.5" /> Enter Waiting Room
                        </button>
                      )
                    ) : m.status === 'completed' ? (
                      <div className="flex-1 flex items-center gap-1.5">
                        <button
                          onClick={() => navigate(`/attendance?meeting=${m.id}`)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-[#F4F5FA] hover:bg-[#E7EAF5] text-xs font-semibold text-[#151722]"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> View Attendance
                        </button>
                        {isHost && (
                          <button
                            onClick={() => handleDeleteMeeting(m.id, m.title)}
                            className="p-2 rounded-full bg-gray-100 hover:bg-rose-50 hover:text-rose-600 text-gray-400 transition-colors"
                            title="Remove Meeting Record"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-between">
                        <span className="text-xs text-rose-500 font-semibold italic flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5" /> Cancelled
                        </span>
                        {isHost && (
                          <button
                            onClick={() => handleDeleteMeeting(m.id, m.title)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700 transition-colors"
                            title="Permanently Remove Meeting"
                          >
                            <Trash2 className="h-3 w-3" /> Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              </StaggerItem>
            )
          })}
        </StaggerGrid>
      )}
    </PageTransition>
  )
}
