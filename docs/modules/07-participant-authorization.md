# Module 07: Participant Authorization & Waiting Room

## Purpose
Guarantees that **only** the meeting's organizer and employees explicitly selected by the organizer can enter a meeting room—even if an unauthorized user obtains the direct `/meetings/:id` link.

## Connected Files
- `src/pages/ScheduleMeetingPage.tsx` — Populates the `meeting_participants` allowlist on creation.
- `src/pages/LiveMeetingPage.tsx` — Runs `verifyEntryAccess()` on mount (`gateState`: `checking` -> `denied` | `waiting_room` | `prejoin`).
- `supabase/functions/meeting-access/index.ts` — Authoritative server-side gate (`action: 'join'`, `admit`, `reject`, `remove`, `invite_participants`).
- Database tables & RLS: `public.meetings`, `public.meeting_participants`, `realtime.messages`, `private.is_admitted_to_meeting()`.

## Working Flow
1. **Access Gate (`meeting-access` `action: 'join'`):**
   - Verifies Bearer JWT (`auth.getUser(token)`) and checks `employees.status === 'active'`.
   - Rejects `cancelled` or `completed` meetings (`403`).
   - Checks `isOrganizer || (participant exists && admission_status not in ('removed', 'rejected'))`.
   - Uninvited employees receive HTTP `403`: `"Access Denied: You are not invited to this meeting."`
2. **Waiting Room (`waiting_room_enabled = true`):**
   - Non-organizer invitees not yet `'admitted'` are set to `meeting_participants.admission_status = 'waiting'` and `attendance.status = 'waiting'` (Yellow).
   - A notification is sent to the organizer, and the employee waits in the Waiting Room UI subscribed to `meeting_participants` & `meetings` Postgres Changes.
   - When the organizer clicks **Admit** in the Participants tab, `meeting-access` sets `admission_status = 'admitted'`, triggering the waiting employee's screen to advance automatically to Pre-Join.
3. **Database Defense-in-Depth:**
   - Even outside the UI, RLS policies block uninvited employees from reading `meetings`, `meeting_messages`, `meeting_agenda`, or subscribing to private Realtime room topics.
