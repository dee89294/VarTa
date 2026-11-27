/**
 * File: src/components/ui/StatusBadge.tsx
 * Purpose: Standardized crisp light-theme semantic pill badges for Roles, Employee Status,
 *   Meeting Status, and Attendance Status matching the team-list pill aesthetic.
 * Why required: Enforces strict semantic colors calibrated for white/alabaster surfaces:
 *   - Green = Active / Present
 *   - Rose Red = Deactivated / Live / Absent
 *   - Amber = Pending Invite / Waiting to join
 *   - Cool Slate = Not invited / Cancelled
 *   - Royal Indigo `#4D4CEF` = Scheduled / Organizer
 *   - Orchid Violet `#9C65E5` = Super Admin
 * Connected files:
 *   - `src/types/database.ts` (`UserRole`, `EmployeeStatus`, `MeetingStatus`, `AttendanceStatus`)
 *   - Consumed across Dashboard, Teams, Employees, Calendar, MyMeetings, LiveMeeting, Attendance, Reports, Settings.
 * Impact if modified/removed: Status tables and pills across dashboards and live attendance panels fail to render.
 */
import { cn } from '../../lib/utils'
import type { AttendanceStatus, EmployeeStatus, MeetingStatus, MemberCategory, UserRole } from '../../types/database'

export function CategoryBadge({ category }: { category: MemberCategory }) {
  const styles: Record<MemberCategory, string> = {
    founder: 'bg-[#15161C] text-white border-[#15161C]',
    managing_director: 'bg-gradient-to-r from-[#4D4CEF] to-[#9C65E5] text-white border-[#4D4CEF]',
    co_founder: 'bg-[#4D4CEF] text-white border-[#4D4CEF]',
    director: 'bg-[#4D4CEF] text-white border-[#4D4CEF]',
    leadership: 'bg-[#9C65E5]/15 text-[#773DC8] border-[#9C65E5]/30',
    department_head: 'bg-[#4D4CEF]/12 text-[#3E3EE0] border-[#4D4CEF]/30',
    manager: 'bg-amber-50 text-amber-700 border-amber-200',
    employee: 'bg-[#F0F2F7] text-[#5B6178] border-[#DDE1EE]',
  }
  const labels: Record<MemberCategory, string> = {
    founder: 'Founder',
    managing_director: 'Managing Director',
    co_founder: 'Director',
    director: 'Director',
    leadership: 'Leadership',
    department_head: 'Department Head',
    manager: 'Manager',
    employee: 'Employee',
  }
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border', styles[category] ?? styles.employee)}>
      {labels[category] ?? 'Employee'}
    </span>
  )
}

export function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    super_admin: 'bg-[#9C65E5]/12 text-[#773DC8] border-[#9C65E5]/25',
    organizer: 'bg-[#4D4CEF]/10 text-[#3F3EE0] border-[#4D4CEF]/25',
    employee: 'bg-[#F0F2F7] text-[#5B6178] border-[#DDE1EE]',
  }
  const labels: Record<UserRole, string> = {
    super_admin: 'Super Admin',
    organizer: 'Organizer',
    employee: 'Employee',
  }
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border', styles[role])}>
      {labels[role]}
    </span>
  )
}

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  const styles: Record<EmployeeStatus, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    invited: 'bg-amber-50 text-amber-700 border-amber-200',
    inactive: 'bg-rose-50 text-rose-700 border-rose-200',
  }
  const dots: Record<EmployeeStatus, string> = {
    active: 'bg-emerald-500',
    invited: 'bg-amber-500',
    inactive: 'bg-rose-500',
  }
  const labels: Record<EmployeeStatus, string> = {
    active: 'Active',
    invited: 'Pending Invite',
    inactive: 'Unactive',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border', styles[status])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dots[status])} />
      {labels[status]}
    </span>
  )
}

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const styles: Record<MeetingStatus, string> = {
    live: 'bg-rose-50 text-rose-700 border-rose-200',
    scheduled: 'bg-[#4D4CEF]/10 text-[#3E3EE0] border-[#4D4CEF]/25',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-[#EFF1F6] text-[#787F96] border-[#DFE3EE]',
  }
  const labels: Record<MeetingStatus, string> = {
    live: 'Live Now',
    scheduled: 'Scheduled',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border', styles[status])}>
      {status === 'live' && <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />}
      {labels[status]}
    </span>
  )
}

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus | 'not_invited' }) {
  const styles: Record<AttendanceStatus | 'not_invited', string> = {
    present: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    absent: 'bg-rose-50 text-rose-700 border-rose-200',
    waiting: 'bg-amber-50 text-amber-700 border-amber-200',
    not_invited: 'bg-[#F0F2F7] text-[#6D738B] border-[#DFE3EE]',
  }
  const dots: Record<AttendanceStatus | 'not_invited', string> = {
    present: 'bg-emerald-500',
    absent: 'bg-rose-500',
    waiting: 'bg-amber-500 animate-pulse',
    not_invited: 'bg-[#9499AE]',
  }
  const labels: Record<AttendanceStatus | 'not_invited', string> = {
    present: 'Present',
    absent: 'Absent',
    waiting: 'Waiting to join',
    not_invited: 'Not invited',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors duration-300', styles[status])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dots[status])} />
      {labels[status]}
    </span>
  )
}
