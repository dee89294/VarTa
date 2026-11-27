# Module 10: Attendance Management, Reports & Analytics

## Purpose
Enables employees to audit their personal attendance history and empowers Organizers and Super Admins to analyze company-wide participation metrics and export CSV or Excel (`.xlsx`) reports.

## Connected Files
- `src/pages/AttendancePage.tsx` — Multi-filter attendance log + KPI cards (`Total Meetings Attended`, `Total Meetings Missed`, `Attendance Percentage`, `Total Participation Duration`).
- `src/pages/ReportsPage.tsx` — Department attendance breakdown progress bars and per-meeting summary audit table.
- `src/lib/export.ts` — `exportAttendanceCSV()` and `exportAttendanceExcel()`.
- Database tables: `public.attendance`, `public.meetings`, `public.employees`, `public.departments`, `public.teams`.

## Working Flow
1. **Role Scoping (Database + UI):**
   - `public.attendance` RLS ensures `'employee'` users only read rows where `employee_id = private.current_employee_id()`.
   - Organizers read attendance for meetings they organize (plus their own attendance); Super Admins read company-wide attendance.
   - `ReportsPage.tsx` prevents `'employee'` accounts from opening company-wide analytics.
2. **Filtering & Highlighting (`AttendancePage.tsx`):**
   - Filters by Date, Employee ID, Employee Name, Department, Team, and Meeting.
   - Renders absent rows with red-highlighted `Employee ID` badges (`EMP004`, etc.) and red `Absent` pills.
3. **Exporting (`src/lib/export.ts`):**
   - `exportAttendanceCSV()` generates an RFC-4180 escaped `.csv` file.
   - `exportAttendanceExcel()` builds an `.xlsx` workbook via `xlsx` (`SheetJS`) with formatted column widths.
