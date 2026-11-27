# Module 05: Calendar Integration & Meeting Locking

## Purpose
Provides a synchronized company calendar (`Monthly`, `Weekly`, and `Daily` views) where scheduled meetings automatically reserve their slot, show locked status, and prevent unauthorized modifications.

## Connected Files
- `src/pages/CalendarPage.tsx`
- `src/pages/ScheduleMeetingPage.tsx`
- `src/pages/LiveMeetingPage.tsx`
- Database table & trigger: `public.meetings`, `private.enforce_meeting_integrity()`.

## Working Flow
1. **Role-Scoped Calendar Visibility:** `CalendarPage.tsx` queries `public.meetings` joined with `organizer`, `meeting_participants`, and `meeting_agenda` and subscribes to Realtime `postgres_changes` on `public.meetings`.
   - Super Admins see all company meetings; Organizers and Employees see only meetings they organized or were invited to.
2. **Views & Filtering:** Users toggle between `Month`, `Week`, and `Day` layouts and filter by `All`, `Upcoming & Live`, `Completed`, or `Cancelled`.
3. **Event Locking & Permissions:**
   - Every scheduled event renders a lock icon (`is_locked = true`).
   - Clicking an event opens the Inspector Modal (`Modal.tsx`).
   - `canModifySelected` is true ONLY when `status` is neither `'completed'` nor `'cancelled'` AND the current user is either `super_admin` or `meeting.organizer_id`.
   - Both Postgres RLS (`UPDATE`/`DELETE` policies on `meetings`) and the `enforce_meeting_integrity` trigger enforce this server-side.
4. **Rescheduling & Cancelling:**
   - Rescheduling updates `scheduled_start`, `scheduled_end`, and `duration_minutes` (re-checked for conflicts by the DB trigger) and inserts `meeting_rescheduled` notifications for all invitees.
   - Cancelling sets `status = 'cancelled'` and sends `meeting_cancelled` notifications.
