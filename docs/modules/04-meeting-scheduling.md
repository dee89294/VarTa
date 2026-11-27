# Module 04: Meeting Scheduling System

## Purpose
Allows Meeting Organizers and Super Admins to schedule meetings, build structured agendas, detect time conflicts, and explicitly authorize which employees are permitted to join.

## Connected Files
- `src/pages/ScheduleMeetingPage.tsx`
- `supabase/functions/meeting-access/index.ts` (`action: 'check_conflicts'`)
- `src/pages/CalendarPage.tsx`
- Database tables: `public.meetings`, `public.meeting_participants`, `public.meeting_agenda`, `public.notifications`, `public.meeting_activity_logs`, `public.platform_settings`.

## Working Flow
1. **Form & Time Setup:** Organizer specifies Title, Description, Date, Start Time, Duration (`15`–`120` mins), and Waiting Room toggle (defaulting to `platform_settings.default_waiting_room`).
2. **Conflict Detection:** As Date, Start Time, Duration, or selected participants change, `ScheduleMeetingPage.tsx` debounces a call to `meeting-access` (`check_conflicts`). Overlapping `scheduled` or `live` meetings for the organizer or selected participants display an immediate warning banner.
3. **Participant Selection Matrix:**
   - Supports individual checkboxes, **Select All**, **Select Department**, **Select Team**, live **Search Employee**, and **Clear Selection**.
   - At least one participant must be selected.
4. **Atomic Persistence (`handleSchedule`):**
   - Generates a `VRT-XXXX` meeting code (`generateMeetingCode()`).
   - Inserts the meeting into `public.meetings` with `is_locked = true` (validated by Postgres trigger `enforce_meeting_integrity` to block overlapping organizer double-booking).
   - Inserts organizer (`role_in_meeting: 'organizer'`, `admission_status: 'admitted'`) and selected invitees (`admission_status: 'invited'`) into `public.meeting_participants`.
   - Saves ordered items into `public.meeting_agenda`, sends `meeting_invited` records to `public.notifications`, and records `meeting_scheduled` in `public.meeting_activity_logs`.
