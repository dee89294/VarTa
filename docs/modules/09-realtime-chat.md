# Module 09: Real-Time Meeting Chat

## Purpose
Provides persistent, low-latency text messaging, system announcements, and emoji reactions scoped exclusively to admitted participants of a live meeting.

## Connected Files
- `src/pages/LiveMeetingPage.tsx` (collapsible `Chat` icon drawer inside the right-edge sidebar, `handleSendChat`, unread badge tracking, Realtime `INSERT` subscription).
- `supabase/functions/meeting-access/index.ts` (inserts `system` chat message when meeting starts).
- Database table & RLS: `public.meeting_messages`, `private.is_admitted_to_meeting()`.

## Working Flow
1. **Authorization:** `public.meeting_messages` RLS policies allow `SELECT` and `INSERT` **only** when `private.is_admitted_to_meeting(meeting_id)` or `private.is_super_admin()` is true (and `sender_employee_id` matches `private.current_employee_id()`).
2. **Sending Messages:** Submitting the chat form (or clicking quick-reaction emojis) inserts `{ meeting_id, sender_employee_id, sender_name, sender_code, content, message_type }` into `public.meeting_messages`.
3. **Real-Time Delivery:** `LiveMeetingPage.tsx` subscribes to `postgres_changes` (`event: 'INSERT'`, `table: 'meeting_messages'`, `filter: meeting_id=eq.${meetingId}`), deduplicates by message ID, appends smoothly, and auto-scrolls to the newest message.
4. **Visual Styling:** Rendered inside the slide-in frosted white-lavender `Chat` drawer of the calling window (`LiveMeetingPage.tsx`), where own messages render in a Royal Indigo-to-Orchid Violet gradient (`from-[#4D4CEF] to-[#8C56DC]`, white text) and colleague messages render on soft cool mist pills (`bg-[#F3F4FA]`) with sender name, `EMP` code, and timestamp.
