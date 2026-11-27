/**
 * File: src/pages/AttendancePage.tsx
 * Purpose: Attendance Management console styled in Crisp White, Soft Alabaster, and Royal Indigo displaying
 *   verified attendance records, KPIs, multi-facet filters, red-highlighted absent Employee IDs, and CSV/Excel exports.
 * Why required: Provides employees with their personal attendance history and gives Organizers/Super Admins
 *   searchable, exportable company/meeting attendance records synced in real time.
 * Connected files:
 *   - `src/App.tsx` (route `/attendance`)
 *   - `src/contexts/AuthContext.tsx` (`employee`, `role` — scopes records for `'employee'` role)
 *   - `src/lib/supabase.ts` (queries `attendance` joined with `employees`, `departments`, `teams`, `meetings`
 *     and subscribes to Realtime `attendance` updates)
 *   - `src/lib/export.ts` (`exportAttendanceCSV`, `exportAttendanceExcel`)
 * Impact if modified/removed: Users cannot audit historical attendance or export CSV/Excel spreadsheets.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Download,
  FileSpreadsheet,
  Search,
  UserCheck,
  UserX,
  Clock,
  Percent,
  FilterX,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { supabase } from '../lib/supabase'
import { exportAttendanceCSV, exportAttendanceExcel, type AttendanceExportRow } from '../lib/export'
import { formatDate, formatDurationSeconds, formatTime } from '../lib/utils'
import { getDisplayEmployeeId } from '../lib/orgUtils'
import { AnimatedCounter, PageTransition } from '../components/ui/MotionPrimitives'
import { Avatar } from '../components/ui/Avatar'
import { AttendanceStatusBadge } from '../components/ui/StatusBadge'
import type { AttendanceRecord, Department, Meeting, Team } from '../types/database'

export function AttendancePage() {
  const { employee, role } = useAuth()
  const { toast } = useToast()
  const [searchParams] = useSearchParams()

  const [rows, setRows] = useState<AttendanceRecord[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)

  const [dateFilter, setDateFilter] = useState('')
  const [empCodeFilter, setEmpCodeFilter] = useState('')
  const [empNameFilter, setEmpNameFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [meetingFilter, setMeetingFilter] = useState(searchParams.get('meeting') ?? '')

  const loadAttendance = useCallback(async () => {
    try {
      const [attRes, deptRes, teamRes, mtRes] = await Promise.all([
        supabase
          .from('attendance')
          .select(
            `*,
             employee:employees!attendance_employee_id_fkey(id, employee_code, full_name, email, department_id, team_id, org_category, is_founding_member, avatar_url, department:departments!employees_department_id_fkey(id, name, code), team:teams!employees_team_id_fkey(id, name, department_id)),
             meeting:meetings!attendance_meeting_id_fkey(id, meeting_code, title, scheduled_start, status, organizer_id)`
          )
          .order('updated_at', { ascending: false }),
        supabase.from('departments').select('*').order('name'),
        supabase.from('teams').select('*').order('name'),
        supabase.from('meetings').select('id, meeting_code, title, scheduled_start, status').order('scheduled_start', { ascending: false }),
      ])

      setRows((attRes.data ?? []) as AttendanceRecord[])
      setDepartments((deptRes.data ?? []) as Department[])
      setTeams((teamRes.data ?? []) as Team[])
      setMeetings((mtRes.data ?? []) as Meeting[])
    } catch (err) {
      toast({
        type: 'error',
        title: 'Failed loading attendance records',
        description: err instanceof Error ? err.message : 'Error',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadAttendance()
    const ch = supabase
      .channel('attendance-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => loadAttendance())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [loadAttendance])

  const scopedRows = useMemo(() => {
    return rows.filter((r) => {
      if (role === 'employee' && r.employee_id !== employee?.id) return false
      if (dateFilter) {
        const d = r.meeting?.scheduled_start?.slice(0, 10)
        if (d !== dateFilter) return false
      }
      if (empCodeFilter.trim()) {
        if (!r.employee?.employee_code?.toLowerCase().includes(empCodeFilter.trim().toLowerCase())) return false
      }
      if (empNameFilter.trim()) {
        if (!r.employee?.full_name?.toLowerCase().includes(empNameFilter.trim().toLowerCase())) return false
      }
      if (deptFilter && r.employee?.department_id !== deptFilter) return false
      if (teamFilter && r.employee?.team_id !== teamFilter) return false
      if (meetingFilter && r.meeting_id !== meetingFilter) return false
      return true
    })
  }, [rows, role, employee?.id, dateFilter, empCodeFilter, empNameFilter, deptFilter, teamFilter, meetingFilter])

  const stats = useMemo(() => {
    const attended = scopedRows.filter((r) => r.status === 'present').length
    const missed = scopedRows.filter((r) => r.status === 'absent').length
    const totalCompleted = attended + missed
    const pct = totalCompleted > 0 ? Math.round((attended / totalCompleted) * 100) : 0
    const durationSecs = scopedRows.reduce((sum, r) => sum + (r.total_duration_seconds || 0), 0)
    return { attended, missed, pct, durationSecs }
  }, [scopedRows])

  const buildExportRows = (): AttendanceExportRow[] =>
    scopedRows.map((r) => ({
      employee_code: getDisplayEmployeeId(r.employee) ?? 'LEADERSHIP',
      employee_name: r.employee?.full_name || '—',
      email: r.employee?.email || '—',
      department: r.employee?.department?.name || '—',
      team: r.employee?.team?.name || '—',
      meeting_code: r.meeting?.meeting_code || '—',
      meeting_title: r.meeting?.title || '—',
      meeting_date: formatDate(r.meeting?.scheduled_start),
      status: r.status,
      join_time: r.join_time ? formatTime(r.join_time) : '—',
      leave_time: r.leave_time ? formatTime(r.leave_time) : '—',
      duration_minutes: Math.round((r.total_duration_seconds || 0) / 60),
    }))

  const canExport = role === 'super_admin' || role === 'organizer'

  return (
    <PageTransition className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight">
            Attendance Management
          </h1>
          <p className="text-sm text-[#6E748C] mt-1">
            {role === 'employee'
              ? 'Your verified meeting attendance history and participation duration.'
              : 'Track verified entry attendance across meetings, departments, and teams. Absent Employee IDs are highlighted in red.'}
          </p>
        </div>

        {canExport && (
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={() => exportAttendanceCSV(buildExportRows())}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white hover:bg-[#F6F7FB] border border-[#E5E8F2] shadow-xs text-xs font-semibold text-[#151722] transition-colors"
            >
              <Download className="h-4 w-4 text-[#4D4CEF]" />
              Export CSV
            </button>
            <button
              onClick={() => exportAttendanceExcel(buildExportRows())}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-md shadow-emerald-600/20"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel
            </button>
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="varta-card rounded-[28px] p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[#7A8099]">Total Meetings Attended</p>
            <p className="font-display text-3xl font-bold text-emerald-600 mt-1">
              <AnimatedCounter value={stats.attended} />
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
            <UserCheck className="h-5 w-5 text-emerald-600" />
          </div>
        </div>

        <div className="varta-card rounded-[28px] p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[#7A8099]">Total Meetings Missed</p>
            <p className="font-display text-3xl font-bold text-rose-600 mt-1">
              <AnimatedCounter value={stats.missed} />
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200">
            <UserX className="h-5 w-5 text-rose-600" />
          </div>
        </div>

        <div className="varta-card rounded-[28px] p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[#7A8099]">Attendance Percentage</p>
            <p className="font-display text-3xl font-bold text-[#4D4CEF] mt-1">
              <AnimatedCounter value={stats.pct} suffix="%" />
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-[#4D4CEF]/10 border border-[#4D4CEF]/20">
            <Percent className="h-5 w-5 text-[#4D4CEF]" />
          </div>
        </div>

        <div className="varta-card rounded-[28px] p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[#7A8099]">Total Participation Duration</p>
            <p className="font-display text-2xl font-bold text-[#151722] mt-1">
              {formatDurationSeconds(stats.durationSecs)}
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-[#9C65E5]/12 border border-[#9C65E5]/25">
            <Clock className="h-5 w-5 text-[#854DD1]" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="varta-card rounded-[24px] p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="varta-input px-3 py-2 rounded-2xl text-xs"
        />
        <div className="relative">
          <Search className="h-3.5 w-3.5 text-[#8D92A8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={empCodeFilter}
            onChange={(e) => setEmpCodeFilter(e.target.value)}
            placeholder="Employee ID"
            className="varta-input w-full pl-8 pr-3 py-2 rounded-2xl font-mono text-xs"
          />
        </div>
        <input
          type="text"
          value={empNameFilter}
          onChange={(e) => setEmpNameFilter(e.target.value)}
          placeholder="Employee Name"
          className="varta-input px-3 py-2 rounded-2xl text-xs"
        />
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
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="varta-select px-3 py-2 rounded-2xl text-xs"
        >
          <option value="">All Teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={meetingFilter}
          onChange={(e) => setMeetingFilter(e.target.value)}
          className="varta-select px-3 py-2 rounded-2xl text-xs"
        >
          <option value="">All Meetings</option>
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.meeting_code} — {m.title}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setDateFilter('')
            setEmpCodeFilter('')
            setEmpNameFilter('')
            setDeptFilter('')
            setTeamFilter('')
            setMeetingFilter('')
          }}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-2xl bg-[#F3F4F9] hover:bg-[#E7EAF5] text-xs font-semibold text-[#454A62]"
        >
          <FilterX className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      {/* Table */}
      <div className="varta-card rounded-[28px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF0F7] bg-[#F8F9FD] text-[11px] font-bold uppercase tracking-wider text-[#7A8099]">
                <th className="py-3.5 px-5">Employee ID</th>
                <th className="py-3.5 px-4">Employee Name</th>
                <th className="py-3.5 px-4">Meeting</th>
                <th className="py-3.5 px-4">Join Time</th>
                <th className="py-3.5 px-4">Leave Time</th>
                <th className="py-3.5 px-4">Duration</th>
                <th className="py-3.5 px-5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F8] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[#8D92A8]">
                    Loading attendance logs...
                  </td>
                </tr>
              ) : scopedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[#8D92A8]">
                    No matching attendance records found.
                  </td>
                </tr>
              ) : (
                scopedRows.map((row) => {
                  const isAbsent = row.status === 'absent'
                  return (
                    <tr key={row.id} className="hover:bg-[#F8F9FD] transition-colors">
                      <td className="py-3 px-5">
                        <span
                          className={`inline-block font-mono px-2.5 py-1 rounded-full border ${
                            isAbsent
                              ? 'bg-rose-50 text-rose-700 border-rose-300 font-bold'
                              : 'bg-[#EFF1F8] text-[#4D4CEF] border-[#DFE3F2] font-semibold'
                          }`}
                        >
                          {getDisplayEmployeeId(row.employee) ?? 'LEADERSHIP'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={row.employee?.full_name} src={row.employee?.avatar_url} size="xs" shape="circle" />
                          <div>
                            <p className="font-bold text-[#151722]">{row.employee?.full_name}</p>
                            <p className="text-[11px] text-[#7D839B]">
                              {row.employee?.department?.name} • {row.employee?.team?.name}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#151722]">{row.meeting?.title}</p>
                        <p className="text-[11px] font-mono text-[#7D839B]">
                          {row.meeting?.meeting_code} • {formatDate(row.meeting?.scheduled_start)}
                        </p>
                      </td>
                      <td className="py-3 px-4 font-mono text-[#454A62]">{formatTime(row.join_time)}</td>
                      <td className="py-3 px-4 font-mono text-[#454A62]">{formatTime(row.leave_time)}</td>
                      <td className="py-3 px-4 font-mono font-semibold text-[#151722]">
                        {formatDurationSeconds(row.total_duration_seconds)}
                      </td>
                      <td className="py-3 px-5 text-right">
                        <AttendanceStatusBadge status={row.status} />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageTransition>
  )
}
