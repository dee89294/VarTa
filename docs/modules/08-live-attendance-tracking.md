# Module 08: Live Employee Attendance Tracking

## Purpose
Automates real-time, tamper-resistant meeting attendance tracking with instant status color coding (`Green = Present`, `Red = Absent` with red-highlighted Employee ID, `Yellow = Waiting to join`, `Grey = Not invited`).

## Connected Files
- `supabase/functions/meeting-access/index.ts` — Controls `start_meeting`, `confirm_entry`, `heartbeat`, `leave`, `end_meeting`.
- `src/pages/LiveMeetingPage.tsx` — Live Attendance panel (`Employee ID | Employee Name | Status` + `"Show uninvited"` toggle + CSV export).
- `src/components/ui/StatusBadge.tsx` — `AttendanceStatusBadge`.
- `src/pages/DashboardPage.tsx` & `src/pages/AttendancePage.tsx`.
- Database table: `public.attendance`.

## Critical Rule: Entry-Verified Attendance
- Clicking **Join** (`action: 'join'`) **never** marks an employee `Present`.
- When the organizer starts a meeting (`start_meeting`), unjoined invitees are seeded in `public.attendance` with `status = 'absent'` (`verified_entry = false`) so their Employee IDs immediately highlight in **Red** in the Live Attendance panel.
- Employees held in a Waiting Room receive `status = 'waiting'` (**Yellow**).
- **Only** when an authorized & admitted participant enters the actual live room (`handleConfirmAndEnter()` -> `action: 'confirm_entry'`) does the Edge Function set `status = 'present'`, `verified_entry = true`, `join_time = now()`, and `last_heartbeat_at = now()`.
- While inside the room, a 25-second `heartbeat` and `leave` call accumulate `total_duration_seconds`.
- When the organizer clicks **End Meeting** (`end_meeting`), active attendees' `leave_time` and duration are finalized, and every remaining invitee with `verified_entry = false` is finalized as `absent`.
- Supabase Realtime `postgres_changes` pushes every transition directly into `LiveMeetingPage.tsx`, `DashboardPage.tsx`, and `AttendancePage.tsx` without refreshing.
