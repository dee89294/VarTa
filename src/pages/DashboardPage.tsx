/**
 * File: src/pages/DashboardPage.tsx
 * Purpose: Role-adaptive Bento Workspace Dashboard styled in the Soft Lavender-Alabaster, Crisp White,
 *   Royal Indigo (`#4D4CEF`), Orchid Violet (`#9C65E5`), and Obsidian Charcoal studio aesthetic.
 * Why required: Surfaces all 6 workspace KPIs, Featured Conference spotlight stage, Announcements/Notes
 *   with numbered indigo pills, Today's Attendance & Team status list (with Red-highlighted absent Employee IDs),
 *   signature tilted Meeting Records showcase card, Upcoming Meetings stack, and Recent Activity feed.
 * Connected files:
 *   - `src/App.tsx` (serves `/dashboard`, `/admin-dashboard`, `/organizer-dashboard`, `/employee-dashboard`)
 *   - `src/contexts/AuthContext.tsx` (`employee`, `role`)
 *   - `src/lib/supabase.ts` (reads `employees`, `meetings`, `attendance`, `announcements`, `meeting_activity_logs`;
 *     subscribes to Realtime updates on `meetings`, `attendance`, `announcements`)
 *   - `src/pages/ScheduleMeetingPage.tsx`, `MyMeetingsPage.tsx`, `AttendancePage.tsx`, `LiveMeetingPage.tsx`, `ReportsPage.tsx`
 * Impact if modified/removed: Users lose their operational overview and quick-launch conference entry.
 */
import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Users,
  CalendarClock,
  CheckCircle2,
  Radio,
  UserCheck,
  UserX,
  CalendarPlus,
  Video,
  Megaphone,
  Activity,
  Clock,
  Plus,
  Check,
  ArrowUpRight,
  Mic,
  Volume2,
  FolderOpen,
  MoreVertical,
  Building2,
  Briefcase,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import { formatDateTime, formatDurationSeconds, formatTime } from '../lib/utils'
import { getDisplayEmployeeId } from '../lib/orgUtils'
import {
  AnimatedCounter,
  PageTransition,
  ScrollReveal,
  SkeletonCard,
  StaggerGrid,
  StaggerItem,
} from '../components/ui/MotionPrimitives'
import { Avatar } from '../components/ui/Avatar'
import { AttendanceStatusBadge, CategoryBadge, MeetingStatusBadge, RoleBadge } from '../components/ui/StatusBadge'
import { Modal } from '../components/ui/Modal'
import { AdminModulesSection } from '../components/admin/AdminModulesSection'
import type { ActivityLogItem, AnnouncementItem, AttendanceRecord, Employee, Meeting } from '../types/database'

export function DashboardPage() {
  const { employee, role } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [teamPeers, setTeamPeers] = useState<Employee[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [meetingTab, setMeetingTab] = useState<'upcoming' | 'history'>('upcoming')
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord[]>([])
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([])
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([])

  // Announcement composer
  const [announceOpen, setAnnounceOpen] = useState(false)
  const [annTitle, setAnnTitle] = useState('')
  const [annContent, setAnnContent] = useState('')
  const [annPriority, setAnnPriority] = useState<'info' | 'important' | 'urgent'>('info')
  const [savingAnn, setSavingAnn] = useState(false)

  const loadDashboard = useCallback(async () => {
    if (!employee) return
    try {
      const [empRes, peersRes, mtRes, attRes, annRes, actRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active')
          .eq('is_founding_member', false),
        supabase
          .from('employees')
          .select('*, department:departments!employees_department_id_fkey(id, name, code)')
          .eq('status', 'active')
          .order('display_order', { ascending: true })
          .limit(12),
        supabase
          .from('meetings')
          .select(
            `*,
             organizer:employees!meetings_organizer_id_fkey(id, employee_code, full_name, designation, avatar_url, org_category, is_founding_member),
             department:departments(id, name, code),
             meeting_participants(id, employee_id, admission_status, employee:employees!meeting_participants_employee_id_fkey(id, full_name, avatar_url, designation, department:departments!employees_department_id_fkey(name)))`
          )
          .order('scheduled_start', { ascending: true }),
        supabase
          .from('attendance')
          .select(
            '*, employee:employees!attendance_employee_id_fkey(id, employee_code, full_name, designation, avatar_url, org_category, is_founding_member), meeting:meetings!attendance_meeting_id_fkey(id, title, meeting_code, scheduled_start, status)'
          )
          .order('updated_at', { ascending: false })
          .limit(30),
        supabase
          .from('announcements')
          .select('*, author:employees!announcements_author_employee_id_fkey(full_name, designation, employee_code)')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase
          .from('meeting_activity_logs')
          .select(
            '*, actor:employees!meeting_activity_logs_actor_employee_id_fkey(full_name, employee_code), meeting:meetings!meeting_activity_logs_meeting_id_fkey(title, meeting_code)'
          )
          .order('created_at', { ascending: false })
          .limit(6),
      ])

      setTotalEmployees(empRes.count ?? 0)
      setTeamPeers((peersRes.data ?? []) as Employee[])
      setMeetings((mtRes.data ?? []) as Meeting[])
      setTodayAttendance((attRes.data ?? []) as AttendanceRecord[])
      setAnnouncements((annRes.data ?? []) as AnnouncementItem[])
      setActivityLogs((actRes.data ?? []) as ActivityLogItem[])
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed to load dashboard',
        description: err instanceof Error ? err.message : 'Check connection',
      })
    } finally {
      setLoading(false)
    }
  }, [employee, toast])

  useEffect(() => {
    loadDashboard()
    const ch = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => loadDashboard())
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [loadDashboard])

  const scheduledMeetings = meetings.filter((m) => m.status === 'scheduled')
  const liveMeetings = meetings.filter((m) => m.status === 'live')
  const completedMeetings = meetings.filter((m) => m.status === 'completed')
  const upcomingMeetings = meetings.filter((m) => m.status === 'live' || m.status === 'scheduled')
  const spotlightMeeting = liveMeetings[0] || scheduledMeetings[0] || completedMeetings[0] || null
  const recordSpotlight = completedMeetings[0] || liveMeetings[0] || upcomingMeetings[0] || null

  const todayAttFiltered = todayAttendance.filter((a) => {
    const start = a.meeting?.scheduled_start ? new Date(a.meeting.scheduled_start) : null
    const now = new Date()
    if (!start) return true
    return Math.abs(now.getTime() - start.getTime()) < 36 * 3600 * 1000 || a.meeting?.status === 'live'
  })

  const presentTodayCount = new Set(todayAttFiltered.filter((a) => a.status === 'present').map((a) => a.employee_id)).size
  const absentTodayCount = new Set(todayAttFiltered.filter((a) => a.status === 'absent').map((a) => a.employee_id)).size

  const myAttendanceRows = todayAttendance.filter((a) => a.employee_id === employee?.id)
  const myPresent = myAttendanceRows.filter((a) => a.status === 'present').length
  const myAbsent = myAttendanceRows.filter((a) => a.status === 'absent').length
  const myTotalSecs = myAttendanceRows.reduce((acc, r) => acc + (r.total_duration_seconds || 0), 0)

  const handlePublishAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee || !annTitle.trim() || !annContent.trim()) return
    setSavingAnn(true)
    try {
      const { error } = await supabase.from('announcements').insert({
        title: annTitle.trim(),
        content: annContent.trim(),
        priority: annPriority,
        author_employee_id: employee.id,
      })
      if (error) throw error
      toast({ type: 'success', title: 'Announcement Published' })
      setAnnTitle('')
      setAnnContent('')
      setAnnounceOpen(false)
      loadDashboard()
    } catch (err) {
      toast({
        type: 'error',
        title: 'Could not publish announcement',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setSavingAnn(false)
    }
  }

  const statCards =
    role === 'employee'
      ? [
          {
            label: 'Assigned Meetings',
            value: meetings.length,
            sub: `${liveMeetings.length} live now`,
            icon: Video,
            tint: 'bg-[#4D4CEF]/10 text-[#4D4CEF]',
          },
          {
            label: 'Meetings Scheduled',
            value: scheduledMeetings.length,
            sub: 'Upcoming slots',
            icon: CalendarClock,
            tint: 'bg-[#9C65E5]/12 text-[#854DD1]',
          },
          {
            label: 'Meetings Attended',
            value: myPresent,
            sub: 'Verified entries',
            icon: UserCheck,
            tint: 'bg-emerald-50 text-emerald-600',
          },
          {
            label: 'Meetings Missed',
            value: myAbsent,
            sub: formatDurationSeconds(myTotalSecs) + ' logged',
            icon: UserX,
            tint: 'bg-rose-50 text-rose-600',
          },
          {
            label: 'Meetings in Progress',
            value: liveMeetings.length,
            sub: 'Ready to join',
            icon: Radio,
            tint: 'bg-amber-50 text-amber-600',
          },
          {
            label: 'Completed Sessions',
            value: completedMeetings.length,
            sub: 'Reports finalized',
            icon: CheckCircle2,
            tint: 'bg-[#EFF1F7] text-[#5B6178]',
          },
        ]
      : [
          {
            label: 'Total Employees',
            value: totalEmployees,
            sub: 'Active directory',
            icon: Users,
            tint: 'bg-[#4D4CEF]/10 text-[#4D4CEF]',
          },
          {
            label: 'Meetings Scheduled',
            value: scheduledMeetings.length,
            sub: 'Locked calendar',
            icon: CalendarClock,
            tint: 'bg-[#9C65E5]/12 text-[#854DD1]',
          },
          {
            label: 'Meetings Completed',
            value: completedMeetings.length,
            sub: 'Reports ready',
            icon: CheckCircle2,
            tint: 'bg-[#EFF1F7] text-[#5B6178]',
          },
          {
            label: 'Meetings in Progress',
            value: liveMeetings.length,
            sub: 'Live WebRTC rooms',
            icon: Radio,
            tint: 'bg-amber-50 text-amber-600',
          },
          {
            label: 'Present Today',
            value: presentTodayCount,
            sub: 'Verified entries',
            icon: UserCheck,
            tint: 'bg-emerald-50 text-emerald-600',
          },
          {
            label: 'Absent Today',
            value: absentTodayCount,
            sub: 'Red ID flagged',
            icon: UserX,
            tint: 'bg-rose-50 text-rose-600',
          },
        ]

  const dashboardRoleTitle =
    role === 'super_admin'
      ? 'Super Admin Workspace'
      : role === 'organizer'
        ? 'Organizer Operations'
        : 'Personal Workspace'

  return (
    <PageTransition className="space-y-6">
      {/* Compact Workspace Role Strip with Department & Designation Identity */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {role && <RoleBadge role={role} />}
          {employee?.org_category && <CategoryBadge category={employee.org_category} />}
          {getDisplayEmployeeId(employee) && (
            <span className="font-mono font-semibold text-[#4D4CEF] bg-white px-2.5 py-1 rounded-full border border-[#E6E8F2]">
              {getDisplayEmployeeId(employee)}
            </span>
          )}
          {employee?.department?.name && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#151722] bg-white px-3 py-1 rounded-full border border-[#E6E8F2]">
              <Building2 className="h-3.5 w-3.5 text-[#4D4CEF]" />
              {employee.department.name}
            </span>
          )}
          {employee?.designation && (
            <span className="inline-flex items-center gap-1.5 font-medium text-[#5E647B] bg-white px-3 py-1 rounded-full border border-[#E6E8F2]">
              <Briefcase className="h-3.5 w-3.5 text-[#9C65E5]" />
              {employee.designation}
            </span>
          )}
          <span className="text-[#6E748C] font-medium hidden xl:inline">• {dashboardRoleTitle}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => navigate('/teams')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white hover:bg-[#F5F6FB] border border-[#E5E8F2] text-xs font-semibold text-[#151722] transition-colors"
          >
            <Users className="h-3.5 w-3.5 text-[#4D4CEF]" />
            Team Directory
          </button>
          {liveMeetings[0] && (
            <button
              onClick={() => navigate(`/meetings/${liveMeetings[0].id}`)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition-all"
            >
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              Join Live: {liveMeetings[0].meeting_code}
            </button>
          )}
          {(role === 'super_admin' || role === 'organizer') && (
            <button
              onClick={() => navigate('/schedule-meeting')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#4D4CEF] hover:bg-[#3F3EE0] text-white text-xs font-semibold shadow-[0_8px_20px_-6px_rgba(77,76,239,0.5)] transition-all hover:scale-[1.02]"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Quick Schedule
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <StaggerGrid className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
          {statCards.map((card) => {
            const Icon = card.icon
            return (
              <StaggerItem key={card.label}>
                <div className="varta-card varta-card-hover rounded-3xl p-4 flex flex-col justify-between h-full">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-[#7A8099] leading-tight">{card.label}</p>
                    <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${card.tint}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="font-display text-2xl sm:text-[26px] font-bold text-[#151722] tracking-tight">
                      <AnimatedCounter value={card.value} />
                    </p>
                    <p className="text-[11px] text-[#8E94AA] mt-0.5 truncate">{card.sub}</p>
                  </div>
                </div>
              </StaggerItem>
            )
          })}
        </StaggerGrid>
      )}

      {/* Super Admin Integrated Organization & Meeting Management Hub */}
      {role === 'super_admin' && (
        <AdminModulesSection meetings={meetings} onMeetingChanged={loadDashboard} />
      )}

      {/* Main Two-Column Bento Grid inspired directly by the Reference Shot */}
      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Left/Center Main Bento (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Conference Stage Showcase Card */}
          <ScrollReveal className="varta-card rounded-[28px] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-display text-base font-bold text-[#151722]">Conference</span>
                <span className="text-[#CBD0E0]">|</span>
                <span className="text-sm font-medium text-[#6C728A] truncate">
                  {spotlightMeeting ? spotlightMeeting.title : 'Ready for your next enterprise call'}
                </span>
              </div>
              {spotlightMeeting && <MeetingStatusBadge status={spotlightMeeting.status} />}
            </div>

            {spotlightMeeting ? (
              <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#2B2E4A] via-[#3A3E6B] to-[#564D8B] min-h-[270px] sm:min-h-[300px] p-5 flex flex-col justify-between text-white shadow-inner">
                {/* Decorative Studio Light */}
                <div className="absolute -top-20 right-10 h-60 w-60 rounded-full bg-[#9C65E5]/30 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 left-12 h-60 w-60 rounded-full bg-[#4D4CEF]/35 blur-3xl pointer-events-none" />

                {/* Top Overlay Bar: Participant Avatar Strip + Live Pill Clock */}
                <div className="relative z-10 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 bg-white/15 backdrop-blur-md border border-white/25 rounded-full p-1 pr-3">
                    <div className="flex -space-x-2">
                      {(spotlightMeeting.meeting_participants ?? []).slice(0, 3).map((p) => (
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
                    <span className="text-[11px] font-semibold text-white">
                      {spotlightMeeting.meeting_participants?.length ?? 0} invited
                    </span>
                  </div>

                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#15161C]/85 backdrop-blur-md text-xs font-mono font-semibold text-white">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        spotlightMeeting.status === 'live' ? 'bg-rose-500 animate-pulse' : 'bg-[#4D4CEF]'
                      }`}
                    />
                    <span>{spotlightMeeting.meeting_code}</span>
                  </div>
                </div>

                {/* Center Stage Info */}
                <div className="relative z-10 my-6 flex flex-col sm:flex-row sm:items-center gap-5">
                  <Avatar
                    name={spotlightMeeting.organizer?.full_name}
                    src={spotlightMeeting.organizer?.avatar_url}
                    size="xl"
                    shape="circle"
                    className="ring-4 ring-white/25 shrink-0"
                  />
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-200">
                      Hosted by {spotlightMeeting.organizer?.full_name || 'Organizer'}
                    </p>
                    <h2 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight truncate">
                      {spotlightMeeting.title}
                    </h2>
                    <p className="text-xs text-white/80 line-clamp-2 max-w-xl">
                      {spotlightMeeting.description ||
                        `Scheduled for ${formatDateTime(spotlightMeeting.scheduled_start)} (${spotlightMeeting.duration_minutes} mins)`}
                    </p>
                  </div>
                </div>

                {/* Bottom Overlay Controls (Mirrors Screenshot Audio Pill & White Crossed-Mic Button) */}
                <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 text-xs text-white">
                    <Volume2 className="h-4 w-4 text-white/90" />
                    <span className="font-medium">{formatDateTime(spotlightMeeting.scheduled_start)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="h-10 w-10 rounded-full bg-white/18 backdrop-blur-md border border-white/25 flex items-center justify-center text-white">
                      <Video className="h-4 w-4" />
                    </span>
                    <span className="h-10 w-10 rounded-full bg-white text-[#4D4CEF] flex items-center justify-center shadow-md">
                      <Mic className="h-4 w-4" />
                    </span>
                    <button
                      onClick={() => navigate(`/meetings/${spotlightMeeting.id}`)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white hover:bg-[#F5F6FB] text-[#151722] text-xs font-bold shadow-lg transition-all hover:scale-[1.03]"
                    >
                      {spotlightMeeting.status === 'live' ? 'Enter Live Room' : 'Open Room Stage'}
                      <ArrowUpRight className="h-3.5 w-3.5 text-[#4D4CEF]" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-3xl bg-[#F6F7FB] border border-dashed border-[#D8DCEB] p-10 text-center space-y-3">
                <Video className="h-8 w-8 text-[#8D92A8] mx-auto" />
                <p className="text-sm font-semibold text-[#151722]">No active or upcoming meetings yet</p>
                <p className="text-xs text-[#6E748C]">Schedule a new session to launch the interactive conference stage.</p>
              </div>
            )}
          </ScrollReveal>

          {/* Lower Two-Column Bento: Notes / Announcements + Team & Today Attendance List */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Announcements & Notes (Matches Numbered Indigo Badges Card) */}
            <ScrollReveal className="varta-card rounded-[28px] p-5 sm:p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-[#4D4CEF]" />
                  <h3 className="font-display text-base font-bold text-[#151722]">Company Notes & Updates</h3>
                </div>
                {(role === 'super_admin' || role === 'organizer') && (
                  <button
                    onClick={() => setAnnounceOpen(true)}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] text-xs font-semibold text-[#151722] transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5 text-[#4D4CEF]" /> Post
                  </button>
                )}
              </div>

              <div className="space-y-2.5 flex-1">
                {announcements.length === 0 ? (
                  <p className="text-xs text-[#8D92A8] py-8 text-center">No announcements posted yet.</p>
                ) : (
                  announcements.slice(0, 4).map((a, idx) => (
                    <div
                      key={a.id}
                      className="p-3 rounded-2xl bg-[#F7F8FC] hover:bg-[#EFF1F8] border border-[#EAEDF6] transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`h-7 min-w-7 px-2 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                            a.priority === 'urgent'
                              ? 'bg-rose-500 text-white'
                              : a.priority === 'important'
                                ? 'bg-[#9C65E5] text-white'
                                : 'bg-[#4D4CEF] text-white'
                          }`}
                        >
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#151722] truncate">{a.title}</p>
                          <p className="text-[11px] text-[#7D839B] truncate">{a.content}</p>
                        </div>
                      </div>
                      <MoreVertical className="h-4 w-4 text-[#A1A6BA] shrink-0" />
                    </div>
                  ))
                )}
              </div>
            </ScrollReveal>

            {/* Today's Attendance & Team List (Matches Screenshot Team List) */}
            <ScrollReveal delay={0.05} className="varta-card rounded-[28px] p-5 sm:p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display text-base font-bold text-[#151722]">
                    {role === 'employee' ? 'My Attendance' : 'Today Attendance'}
                  </h3>
                  <p className="text-[11px] text-[#7D839B]">Absent IDs highlighted in red</p>
                </div>
                <button
                  onClick={() => navigate('/attendance')}
                  className="text-xs font-semibold text-[#7D839B] hover:text-[#4D4CEF] transition-colors"
                >
                  View All
                </button>
              </div>

              <div className="space-y-3 flex-1">
                {(role === 'employee' ? myAttendanceRows : todayAttFiltered).slice(0, 4).map((row) => {
                  const isAbsent = row.status === 'absent'
                  return (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-2xl hover:bg-[#F7F8FC] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          name={row.employee?.full_name}
                          src={row.employee?.avatar_url}
                          size="sm"
                          shape="circle"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold border ${
                                isAbsent
                                  ? 'bg-rose-50 text-rose-700 border-rose-300'
                                  : 'bg-[#EFF1F8] text-[#4D4CEF] border-[#DFE3F2]'
                              }`}
                            >
                              {getDisplayEmployeeId(row.employee) ?? 'LEADERSHIP'}
                            </span>
                            <p className="text-xs font-bold text-[#151722] truncate">{row.employee?.full_name}</p>
                          </div>
                          <p className="text-[11px] text-[#8E94AA] truncate mt-0.5">{row.meeting?.title}</p>
                        </div>
                      </div>
                      <AttendanceStatusBadge status={row.status} />
                    </div>
                  )
                })}

                {(role === 'employee' ? myAttendanceRows : todayAttFiltered).length === 0 && (
                  <p className="text-xs text-[#8D92A8] py-8 text-center">No attendance records logged today.</p>
                )}
              </div>
            </ScrollReveal>
          </div>
        </div>

        {/* Right Bento Sidebar (4 cols — Mirrors "Meeting Records" Tilted Card + "Upcoming Meetings") */}
        <div className="lg:col-span-4 space-y-6">
          {/* Featured Royal Indigo Tilted Card ("Meeting Records") */}
          <ScrollReveal className="varta-card rounded-[28px] p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-bold text-[#151722]">Meeting Records</h3>
              <button
                onClick={() => navigate('/reports')}
                className="text-xs font-semibold text-[#7D839B] hover:text-[#4D4CEF] transition-colors"
              >
                See All
              </button>
            </div>

            {recordSpotlight ? (
              <div className="p-3 rounded-3xl border border-dashed border-[#D6DAE9] bg-[#F8F9FD]">
                <motion.div
                  whileHover={{ rotate: 0, scale: 1.01 }}
                  onClick={() =>
                    navigate(recordSpotlight.status === 'completed' ? `/attendance?meeting=${recordSpotlight.id}` : `/meetings/${recordSpotlight.id}`)
                  }
                  className="cursor-pointer rounded-3xl bg-gradient-to-br from-[#4446E4] via-[#4E51EE] to-[#5B5DF6] text-white p-5 shadow-[0_18px_36px_-12px_rgba(77,76,239,0.55)] -rotate-1 hover:rotate-0 transition-transform duration-300 space-y-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm text-[11px] font-semibold text-white">
                      {recordSpotlight.department?.name || recordSpotlight.meeting_code}
                    </span>
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      <span className="h-1.5 w-1.5 rounded-full bg-white/50" />
                    </span>
                  </div>

                  <div>
                    <h4 className="font-display text-lg font-bold leading-snug line-clamp-2">
                      {recordSpotlight.title}
                    </h4>
                    <p className="inline-flex items-center gap-1.5 text-xs text-white/80 mt-2">
                      <Clock className="h-3.5 w-3.5" />
                      {recordSpotlight.duration_minutes} mins • {recordSpotlight.status}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="flex -space-x-2">
                      {(recordSpotlight.meeting_participants ?? []).slice(0, 3).map((p) => (
                        <Avatar
                          key={p.id}
                          name={p.employee?.full_name || 'Member'}
                          src={p.employee?.avatar_url}
                          size="xs"
                          shape="circle"
                          className="ring-2 ring-[#4D4CEF]"
                        />
                      ))}
                      {(recordSpotlight.meeting_participants?.length ?? 0) > 3 && (
                        <span className="h-7 w-7 rounded-full bg-white/20 text-[10px] font-bold flex items-center justify-center ring-2 ring-[#4D4CEF]">
                          +{(recordSpotlight.meeting_participants?.length ?? 0) - 3}
                        </span>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-white/90">
                      <FolderOpen className="h-3.5 w-3.5" />
                      Audit Logs
                    </span>
                  </div>
                </motion.div>
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-[#F6F7FB] text-center text-xs text-[#8D92A8]">
                No completed records archived yet.
              </div>
            )}
          </ScrollReveal>

          {/* Upcoming Invitations & Meeting History (With Participating Colleagues) */}
          <ScrollReveal delay={0.05} className="varta-card rounded-[28px] p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex rounded-full bg-[#F3F4F9] p-1 border border-[#E6E8F2]">
                <button
                  onClick={() => setMeetingTab('upcoming')}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    meetingTab === 'upcoming' ? 'bg-white text-[#151722] shadow-2xs' : 'text-[#6E748C]'
                  }`}
                >
                  Upcoming ({upcomingMeetings.length})
                </button>
                <button
                  onClick={() => setMeetingTab('history')}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    meetingTab === 'history' ? 'bg-white text-[#151722] shadow-2xs' : 'text-[#6E748C]'
                  }`}
                >
                  History ({completedMeetings.length})
                </button>
              </div>
              <button
                onClick={() => navigate('/my-meetings')}
                className="text-xs font-semibold text-[#7D839B] hover:text-[#4D4CEF] transition-colors"
              >
                See All
              </button>
            </div>

            <div className="space-y-3">
              {(() => {
                const list = meetingTab === 'upcoming' ? upcomingMeetings : completedMeetings
                if (list.length === 0) {
                  return (
                    <div className="py-8 text-center text-xs text-[#8D92A8]">
                      {meetingTab === 'upcoming' ? 'No upcoming invitations.' : 'No completed meeting history yet.'}
                    </div>
                  )
                }
                return list.slice(0, 3).map((m, idx) => {
                  const isFeatured = meetingTab === 'upcoming' && idx === 0
                  const colleagueNames = (m.meeting_participants ?? [])
                    .map((p) => p.employee?.full_name?.split(' ')[0])
                    .filter(Boolean)
                    .slice(0, 3)
                  return (
                    <div
                      key={m.id}
                      className={
                        isFeatured
                          ? 'rounded-3xl bg-gradient-to-br from-[#A16AE8] to-[#8C56DC] text-white p-4 shadow-[0_16px_32px_-12px_rgba(156,101,229,0.5)] flex items-center justify-between gap-3'
                          : 'rounded-3xl bg-[#ECEEF5] text-[#151722] p-4 flex items-center justify-between gap-3'
                      }
                    >
                      <div className="min-w-0 space-y-2">
                        <div>
                          <h4 className="font-display text-sm font-bold truncate">{m.title}</h4>
                          <p className={`text-[11px] truncate ${isFeatured ? 'text-white/85' : 'text-[#666C85]'}`}>
                            {m.meeting_code} • Host: {m.organizer?.full_name || 'Organizer'}
                          </p>
                          {colleagueNames.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <div className="flex -space-x-1.5">
                                {(m.meeting_participants ?? []).slice(0, 3).map((p) => (
                                  <Avatar
                                    key={p.id}
                                    name={p.employee?.full_name || 'Member'}
                                    src={p.employee?.avatar_url}
                                    size="xs"
                                    shape="circle"
                                    className={isFeatured ? 'ring-1 ring-white/80' : 'ring-1 ring-[#ECEEF5]'}
                                  />
                                ))}
                              </div>
                              <span className={`text-[10px] truncate ${isFeatured ? 'text-white/85' : 'text-[#767D96]'}`}>
                                With {colleagueNames.join(', ')}
                                {(m.meeting_participants?.length ?? 0) > 3
                                  ? ` +${(m.meeting_participants?.length ?? 0) - 3}`
                                  : ''}
                              </span>
                            </div>
                          )}
                        </div>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                            isFeatured ? 'bg-white/20 text-white' : 'bg-white text-[#151722] shadow-2xs'
                          }`}
                        >
                          <Clock className="h-3 w-3" />
                          {formatTime(m.scheduled_start)}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button
                          onClick={() =>
                            navigate(meetingTab === 'history' ? `/attendance?meeting=${m.id}` : `/meetings/${m.id}`)
                          }
                          title={meetingTab === 'history' ? 'View Attendance History' : 'Join Meeting Room'}
                          className={`h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 shadow-sm ${
                            isFeatured ? 'bg-white text-[#8C56DC]' : 'bg-[#4D4CEF] text-white'
                          }`}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => navigate('/calendar')}
                          title="View on Calendar"
                          className={`h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${
                            isFeatured ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-[#DCDFE9] text-[#5C627A] hover:bg-[#D0D4E2]'
                          }`}
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </ScrollReveal>

          {/* My Department & Company Team Directory Preview */}
          <ScrollReveal delay={0.08} className="varta-card rounded-[28px] p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#151722]">Company Team Directory</h3>
                <p className="text-[11px] text-[#7D839B]">
                  {employee?.department?.name ? `${employee.department.name} & Colleagues` : 'Active Company Roster'}
                </p>
              </div>
              <button
                onClick={() => navigate('/teams')}
                className="text-xs font-semibold text-[#4D4CEF] hover:underline"
              >
                Explore All
              </button>
            </div>
            <div className="space-y-2">
              {[...teamPeers]
                .sort((a, b) => Number(b.department_id === employee?.department_id) - Number(a.department_id === employee?.department_id))
                .slice(0, 4)
                .map((peer) => (
                  <div
                    key={peer.id}
                    className="p-2.5 rounded-2xl bg-[#F7F8FC] border border-[#EAEDF6] flex items-center justify-between gap-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={peer.full_name} src={peer.avatar_url} size="xs" shape="circle" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#151722] truncate">{peer.full_name}</p>
                        <p className="text-[10px] text-[#7D839B] truncate">
                          {peer.designation} • {peer.department?.name || 'VarTa'}
                        </p>
                      </div>
                    </div>
                    <CategoryBadge category={peer.org_category || 'employee'} />
                  </div>
                ))}
            </div>
          </ScrollReveal>

          {/* Recent Meeting Activity */}
          <ScrollReveal delay={0.1} className="varta-card rounded-[28px] p-5 sm:p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#4D4CEF]" />
              <h3 className="font-display text-base font-bold text-[#151722]">Recent Activity</h3>
            </div>
            <div className="space-y-2.5">
              {activityLogs.slice(0, 4).map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-2xl bg-[#F7F8FC] border border-[#EAEDF6] flex items-center justify-between gap-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#454A62] truncate">
                      <span className="font-bold text-[#151722]">{log.actor?.full_name || 'System'}</span>{' '}
                      {log.action.replace(/_/g, ' ')}
                    </p>
                    <p className="text-[11px] text-[#8E94AA] truncate">
                      {log.meeting?.meeting_code} • {log.meeting?.title}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-[#7D839B] shrink-0">{formatTime(log.created_at)}</span>
                </div>
              ))}
              {activityLogs.length === 0 && (
                <p className="text-center py-4 text-xs text-[#8D92A8]">No recent activity recorded yet.</p>
              )}
            </div>
          </ScrollReveal>
        </div>
      </div>

      {/* Announcement Modal */}
      <Modal
        open={announceOpen}
        onClose={() => setAnnounceOpen(false)}
        title="Publish Company Announcement"
        subtitle="Visible across all employee dashboards immediately"
      >
        <form onSubmit={handlePublishAnnouncement} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Title</label>
            <input
              type="text"
              required
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
              placeholder="e.g. Q4 Engineering All-Hands Schedule"
              className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Priority</label>
            <select
              value={annPriority}
              onChange={(e) => setAnnPriority(e.target.value as 'info' | 'important' | 'urgent')}
              className="varta-select w-full px-3.5 py-2.5 rounded-2xl text-sm"
            >
              <option value="info">Info</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#454A62] mb-1.5">Message</label>
            <textarea
              required
              rows={4}
              value={annContent}
              onChange={(e) => setAnnContent(e.target.value)}
              placeholder="Write the announcement details..."
              className="varta-input w-full px-3.5 py-2.5 rounded-2xl text-sm"
            />
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setAnnounceOpen(false)}
              className="px-4 py-2 rounded-full bg-[#F1F3F9] hover:bg-[#E4E7F2] text-xs font-semibold text-[#454A62]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingAnn}
              className="px-5 py-2 rounded-full bg-[#15161C] hover:bg-[#262835] text-xs font-semibold text-white"
            >
              {savingAnn ? 'Publishing...' : 'Publish Announcement'}
            </button>
          </div>
        </form>
      </Modal>
    </PageTransition>
  )
}
