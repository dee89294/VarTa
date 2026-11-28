# VarTa — Project Architecture & Developer Documentation

VarTa is a lightweight real-time video conferencing platform built with **React 19, TypeScript, Vite, Tailwind CSS v4, LiveKit Cloud**, and **Supabase**.

---

## 1. Routes & Access Model

| Route | Access | Component | Purpose |
|---|---|---|---|
| `/` | Public | `src/pages/HomePage.tsx` | Minimal landing page with Create Meeting, Join Meeting, Login, Sign Up |
| `/login` | Public (redirect guard) | `src/pages/LoginPage.tsx` | Email/password login + Forgot Password recovery via `auth-email`; respects `?redirect=` |
| `/register`, `/signup` | Public (redirect guard) | `src/pages/RegisterPage.tsx` | Account creation; respects `?redirect=` so invited users return to their meeting |
| `/reset-password` | Public / Recovery | `src/pages/ResetPasswordPage.tsx` | Completes password reset via recovery link or 6-digit OTP |
| `/dashboard` | Authenticated | `src/pages/DashboardPage.tsx` | User home with Create New Meeting, Join Meeting input, and My Meetings preview |
| `/create-meeting` | Authenticated | `src/pages/CreateMeetingPage.tsx` | Instant/scheduled meeting setup, invite email dispatch, copy & WhatsApp sharing |
| `/my-meetings` | Authenticated | `src/pages/MyMeetingsPage.tsx` | Hosted & invited meetings list with share links, additional invites, end & delete controls |
| `/meeting/:id`, `/meetings/:id` | Organizer / Invitee / Guest with Token | `src/pages/MeetingRoomPage.tsx` | Pre-join identity/guest screen, Waiting Room polling, and active `LiveKitRoomView` |

---

## 2. Database Schema (`public`)

Defined cleanly in `supabase/migrations/20261128000001_varta_clean_livekit_schema.sql`:

1. **`public.profiles`**
   - `id` (`uuid`, FK -> `auth.users(id) on delete cascade`), `full_name`, `email`, timestamps.
   - Populated automatically by `private.handle_new_auth_user()` trigger on `auth.users`.
2. **`public.meetings`**
   - `id`, `meeting_code` (`vrt-xxxx-xxxx`, unique), `meeting_title`, `organizer_id` (FK -> `public.profiles(id)`), `meeting_status` (`scheduled | active | ended | cancelled`), `is_instant`, `waiting_room_enabled`, `share_token_hash` (SHA-256), `scheduled_at`, `started_at`, `ended_at`.
3. **`public.meeting_invitations`**
   - `id`, `meeting_id`, `invitee_email`, `secure_invitation_token_hash` (SHA-256), `invitation_status` (`pending | accepted | revoked`).
4. **`public.meeting_participants`**
   - `id`, `meeting_id`, `user_id` (nullable for guests), `full_name`, `email`, `participant_type` (`organizer | registered | guest`), `participant_identity`, `admission_status` (`waiting | admitted | removed`), `joined_at`, `left_at`.

### Security & Privacy Design
- Direct `anon` table grants are revoked across `public.*`.
- Authenticated queries use tight RLS helpers in `private`: `is_varta_organizer(uuid)`, `is_varta_invited_user(uuid)`, and `is_varta_participant(uuid)`.
- `meetings.share_token_hash` is never selected in frontend queries; organizers request share URLs via `meeting-invitations` (`get_share_link`).
- Legacy company tables removed in `20261128000001` are preserved in the server-only `backup_pre_varta_refactor` schema, alongside `private.runtime_mail_config` + `public.get_smtp_runtime_config()`.

---

## 3. Supabase Edge Functions (`supabase/functions/`)

| Function | JWT Gateway | Responsibilities |
|---|---|---|
| `get-livekit-token` | Disabled (`verify_jwt: false`), validated in code | Validates organizer JWT / invitee email / `?token=` / `?invite=`; handles `preview`, `join_token`, `leave`, `admit_participant`, `remove_participant`, and `end_meeting` (LiveKit `DeleteRoom`); mints signed HS256 LiveKit tokens with `LIVEKIT_API_KEY` & `LIVEKIT_API_SECRET` |
| `meeting-invitations` | Disabled (`verify_jwt: false`), requires valid user JWT | Handles `create_meeting`, `send_invitations`, and `get_share_link`; hashes invite & deterministic share tokens (SHA-256) and sends VARTA invite emails via `_shared/mailer.ts` |
| `auth-email` | Disabled (`verify_jwt: false`) | Verifies account exists in `public.profiles`, generates Supabase recovery link/OTP, and emails reset instructions via `_shared/mailer.ts` |
| `_shared/mailer.ts` | Shared module | Reads `public.get_smtp_runtime_config()` (backed by Supabase Vault `varta_smtp_pass`), executes TLS/STARTTLS SMTP or Resend delivery, and formats VARTA invitation HTML |
