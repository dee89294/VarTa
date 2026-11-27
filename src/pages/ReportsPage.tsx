/**
 * File: src/pages/ReportsPage.tsx
 * Purpose: Enterprise Reports & Analytics page styled in Crisp White, Soft Alabaster, Royal Indigo (`#4D4CEF`),
 *   and Orchid Violet (`#9C65E5`) for Organizers and Super Admins.
 * Why required: Aggregates company-wide attendance rates, department-level attendance breakdowns,
 *   average session participation duration, and per-meeting CSV/Excel audit downloads.
 * Connected files:
 *   - `src/App.tsx` (route `/reports`)
 *   - `src/contexts/AuthContext.tsx` (`role` — blocks `'employee'` role from company-wide analytics)
 *   - `src/lib/supabase.ts` (reads `attendance`, `meetings`, `departments`)
 *   - `src/lib/export.ts` (`exportAttendanceCSV`, `exportAttendanceExcel`)
 * Impact if modified/removed: Leadership and organizers lose department analytics and per-meeting report exports.
 */
import { useEffect, useState, useMemo } from 'react'
import { Download, FileSpreadsheet, BarChart3, TrendingUp, Award, AlertCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { exportAttendanceCSV, exportAttendanceExcel, type AttendanceExportRow } from '../lib/export'
import { formatDate, formatDurationSeconds, formatTime } from '../lib/utils'
import { getDisplayEmployeeId } from '../lib/orgUtils'
import { AnimatedCounter, PageTransition, ScrollReveal } from '../components/ui/MotionPrimitives'
import { MeetingStatusBadge } from '../components/ui/StatusBadge'
import type { AttendanceRecord, Department, Meeting } from '../types/database'

export function ReportsPage() {
  const { role } = useAuth()
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [attRes, mtRes, deptRes] = await Promise.all([
          supabase
            .from('attendance')
            .select(
              `*,
               employee:employees!attendance_employee_id_fkey(id, employee_code, full_name, email, department_id, org_category, is_founding_member, department:departments!employees_department_id_fkey(id, name, code), team:teams!employees_team_id_fkey(id, name)),
               meeting:meetings!attendance_meeting_id_fkey(id, meeting_code, title, scheduled_start, status, duration_minutes)`
            ),
          supabase
            .from('meetings')
            .select('*, organizer:employees!meetings_organizer_id_fkey(full_name, employee_code)')
            .order('scheduled_start', { ascending: false }),
          supabase.from('departments').select('*').order('name'),
        ])
        setAttendance((attRes.data ?? []) as AttendanceRecord[])
        setMeetings((mtRes.data ?? []) as Meeting[])
        setDepartments((deptRes.data ?? []) as Department[])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const departmentStats = useMemo(() => {
    return departments.map((dept) => {
      const rows = attendance.filter((a) => a.employee?.department_id === dept.id)
      const present = rows.filter((r) => r.status === 'present').length
      const absent = rows.filter((r) => r.status === 'absent').length
      const total = present + absent
      const rate = total > 0 ? Math.round((present / total) * 100) : 0
      return { dept, present, absent, total, rate }
    })
  }, [departments, attendance])

  const meetingSummaries = useMemo(() => {
    return meetings
      .filter((m) => m.status === 'completed' || m.status === 'live')
      .map((m) => {
        const rows = attendance.filter((a) => a.meeting_id === m.id)
        const present = rows.filter((r) => r.status === 'present').length
        const absent = rows.filter((r) => r.status === 'absent').length
        const avgSecs =
          present > 0
            ? Math.round(
                rows.filter((r) => r.status === 'present').reduce((s, r) => s + (r.total_duration_seconds || 0), 0) /
                  present
              )
            : 0
        const rate = present + absent > 0 ? Math.round((present / (present + absent)) * 100) : 0
        return { meeting: m, rows, present, absent, avgSecs, rate }
      })
  }, [meetings, attendance])

  const overallRate = useMemo(() => {
    const present = attendance.filter((a) => a.status === 'present').length
    const absent = attendance.filter((a) => a.status === 'absent').length
    return present + absent > 0 ? Math.round((present / (present + absent)) * 100) : 0
  }, [attendance])

  const toExportRows = (list: AttendanceRecord[]): AttendanceExportRow[] =>
    list.map((r) => ({
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

  if (role === 'employee') {
    return (
      <PageTransition>
        <div className="varta-card rounded-[28px] p-10 text-center max-w-lg mx-auto mt-10">
          <BarChart3 className="h-10 w-10 text-[#4D4CEF] mx-auto mb-3" />
          <h2 className="font-display text-xl font-bold text-[#151722]">Organizer & Admin Analytics</h2>
          <p className="text-sm text-[#666C85] mt-2">
            Company-wide attendance reports are restricted to Organizers and Super Admins. View your personal logs in
            the Attendance page.
          </p>
        </div>
      </PageTransition>
    )
  }

  return (
    <PageTransition className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#151722] tracking-tight">
            Reports & Analytics
          </h1>
          <p className="text-sm text-[#6E748C] mt-1">
            Company-wide meeting attendance trends, department compliance, and exportable audit logs.
          </p>
        </div>
        <div className="flex gap-2.5">
          <button
            onClick={() => exportAttendanceCSV(toExportRows(attendance), 'varta-company-report.csv')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white hover:bg-[#F6F7FB] border border-[#E5E8F2] shadow-xs text-xs font-semibold text-[#151722]"
          >
            <Download className="h-4 w-4 text-[#4D4CEF]" />
            Export All CSV
          </button>
          <button
            onClick={() => exportAttendanceExcel(toExportRows(attendance), 'varta-company-report.xlsx')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-md shadow-emerald-600/20"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export All Excel
          </button>
        </div>
      </div>

      {/* Top Insights */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="varta-card rounded-[28px] p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[#7A8099]">Overall Attendance Rate</p>
            <p className="font-display text-3xl font-bold text-emerald-600 mt-1">
              <AnimatedCounter value={overallRate} suffix="%" />
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </div>
        </div>

        <div className="varta-card rounded-[28px] p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[#7A8099]">Audited Sessions</p>
            <p className="font-display text-3xl font-bold text-[#4D4CEF] mt-1">
              <AnimatedCounter value={meetingSummaries.length} />
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-[#4D4CEF]/10 border border-[#4D4CEF]/20">
            <Award className="h-5 w-5 text-[#4D4CEF]" />
          </div>
        </div>

        <div className="varta-card rounded-[28px] p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[#7A8099]">Total Absences Logged</p>
            <p className="font-display text-3xl font-bold text-rose-600 mt-1">
              <AnimatedCounter value={attendance.filter((a) => a.status === 'absent').length} />
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200">
            <AlertCircle className="h-5 w-5 text-rose-600" />
          </div>
        </div>
      </div>

      {/* Department Attendance Progress Bars */}
      <ScrollReveal className="varta-card rounded-[28px] p-6 space-y-4">
        <h2 className="font-display text-lg font-bold text-[#151722]">Department Attendance Breakdown</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {departmentStats.map((d) => (
            <div key={d.dept.id} className="p-4 rounded-2xl bg-[#F6F7FB] border border-[#E6E8F2] space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#151722]">
                  {d.dept.name} <span className="font-mono text-[#7D839B]">({d.dept.code})</span>
                </span>
                <span className="font-mono font-bold text-[#4D4CEF]">{d.rate}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-[#E3E6F2] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#4D4CEF] to-[#9C65E5] transition-all duration-700"
                  style={{ width: `${d.rate}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] font-semibold">
                <span className="text-emerald-600">{d.present} present</span>
                <span className="text-rose-600">{d.absent} absent</span>
              </div>
            </div>
          ))}
        </div>
      </ScrollReveal>

      {/* Per-Meeting Report Cards */}
      <ScrollReveal className="varta-card rounded-[28px] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#EEF0F7] bg-[#F8F9FD]">
          <h2 className="font-display text-lg font-bold text-[#151722]">Meeting Attendance Audit Reports</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#EEF0F7] bg-[#F8F9FD] text-[11px] font-bold uppercase tracking-wider text-[#7A8099]">
                <th className="py-3 px-5">Meeting</th>
                <th className="py-3 px-4">Organizer</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Present</th>
                <th className="py-3 px-4">Absent</th>
                <th className="py-3 px-4">Avg Duration</th>
                <th className="py-3 px-5 text-right">Export</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F8] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[#8D92A8]">
                    Generating analytics...
                  </td>
                </tr>
              ) : (
                meetingSummaries.map(({ meeting, rows, present, absent, avgSecs, rate }) => (
                  <tr key={meeting.id} className="hover:bg-[#F8F9FD]">
                    <td className="py-3.5 px-5">
                      <p className="font-bold text-[#151722]">{meeting.title}</p>
                      <p className="text-[11px] font-mono text-[#7D839B]">
                        {meeting.meeting_code} • {formatDate(meeting.scheduled_start)}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-[#454A62] font-medium">{meeting.organizer?.full_name}</td>
                    <td className="py-3.5 px-4">
                      <MeetingStatusBadge status={meeting.status} />
                    </td>
                    <td className="py-3.5 px-4 font-bold text-emerald-600">
                      {present} ({rate}%)
                    </td>
                    <td className="py-3.5 px-4 font-bold text-rose-600">{absent}</td>
                    <td className="py-3.5 px-4 font-mono text-[#454A62]">{formatDurationSeconds(avgSecs)}</td>
                    <td className="py-3.5 px-5 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => exportAttendanceCSV(toExportRows(rows), `${meeting.meeting_code}-attendance.csv`)}
                          className="px-3 py-1 rounded-full bg-[#F3F4F9] hover:bg-[#E7EAF5] text-[11px] font-semibold text-[#151722]"
                        >
                          CSV
                        </button>
                        <button
                          onClick={() => exportAttendanceExcel(toExportRows(rows), `${meeting.meeting_code}-attendance.xlsx`)}
                          className="px-3 py-1 rounded-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[11px] font-semibold text-emerald-700"
                        >
                          Excel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </ScrollReveal>
    </PageTransition>
  )
}
