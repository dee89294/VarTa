/**
 * File: src/lib/export.ts
 * Purpose: Client-side attendance report generator producing downloadable `.csv` and `.xlsx` (Excel) files.
 * Why required: Organizers and Super Admins must be able to export live and completed meeting attendance logs.
 * Connected files:
 *   - `src/pages/AttendancePage.tsx` (exports filtered company or meeting attendance records)
 *   - `src/pages/ReportsPage.tsx` (exports per-meeting or full audit reports)
 *   - `src/pages/LiveMeetingPage.tsx` (exports real-time in-call attendance snapshots)
 *   - `xlsx` npm dependency (generates native Excel workbooks)
 * Impact if modified/removed: CSV and Excel export buttons across Attendance, Reports, and Live Meeting break.
 */
import * as XLSX from 'xlsx'

/** Normalized flat row shape accepted by both CSV and Excel exporters. */
export interface AttendanceExportRow {
  employee_code: string
  employee_name: string
  email: string
  department: string
  team: string
  meeting_code: string
  meeting_title: string
  meeting_date: string
  status: string
  join_time: string
  leave_time: string
  duration_minutes: number
}

/** Escapes RFC-4180 CSV values and downloads a `.csv` report directly in the browser. */
export function exportAttendanceCSV(rows: AttendanceExportRow[], filename = 'varta-attendance-report.csv') {
  const headers = [
    'Employee ID',
    'Employee Name',
    'Email',
    'Department',
    'Team',
    'Meeting Code',
    'Meeting Title',
    'Meeting Date',
    'Status',
    'Join Time',
    'Leave Time',
    'Duration (mins)',
  ]

  const escape = (val: string | number) => {
    const str = String(val ?? '')
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.employee_code,
        r.employee_name,
        r.email,
        r.department,
        r.team,
        r.meeting_code,
        r.meeting_title,
        r.meeting_date,
        r.status,
        r.join_time,
        r.leave_time,
        r.duration_minutes,
      ]
        .map(escape)
        .join(',')
    ),
  ]

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, filename)
}

/** Builds a column-sized Excel `.xlsx` workbook via SheetJS (`xlsx`) and triggers browser download. */
export function exportAttendanceExcel(rows: AttendanceExportRow[], filename = 'varta-attendance-report.xlsx') {
  const worksheetData = rows.map((r) => ({
    'Employee ID': r.employee_code,
    'Employee Name': r.employee_name,
    Email: r.email,
    Department: r.department,
    Team: r.team,
    'Meeting Code': r.meeting_code,
    'Meeting Title': r.meeting_title,
    'Meeting Date': r.meeting_date,
    Status: r.status.toUpperCase(),
    'Join Time': r.join_time,
    'Leave Time': r.leave_time,
    'Duration (mins)': r.duration_minutes,
  }))

  const ws = XLSX.utils.json_to_sheet(worksheetData)
  ws['!cols'] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 28 },
    { wch: 20 },
    { wch: 20 },
    { wch: 14 },
    { wch: 30 },
    { wch: 18 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
    { wch: 15 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
  XLSX.writeFile(wb, filename)
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
