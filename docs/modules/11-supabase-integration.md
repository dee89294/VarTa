# Module 11: Supabase Platform Integration

## Purpose
Integrates **VarTa** end-to-end with the existing Supabase project (`wmmdgdwqtezzkhevcanp`) across Authentication, PostgreSQL, Realtime, Storage, and Edge Functions with zero separate custom backend server.

## Connected Files
- `.env.local` & `.env.example` — Public project URL (`VITE_SUPABASE_URL`) and publishable API key (`VITE_SUPABASE_PUBLISHABLE_KEY`).
- `src/lib/supabase.ts` — Client SDK initialization + `invokeEdgeFunction()`.
- `supabase/migrations/20261126000001_initial_varta_schema.sql` — Schema, indexes, triggers, RLS, Storage, Realtime.
- `supabase/functions/*` — Server-side Deno Edge Functions (`employee-registration`, `admin-manage-users`, `meeting-access`, `bootstrap-seed`).

## Integration Pillars
1. **Supabase Auth (`auth.users`):**
   - Email/password login (`supabase.auth.signInWithPassword`) and password updates (`supabase.auth.updateUser`).
   - New employee accounts are provisioned server-side via `auth.admin.createUser()` ONLY after verifying HR records.
   - Authorization uses `public.user_roles` and `app_metadata` (never mutable `user_metadata`).
2. **PostgreSQL + RLS:**
   - 13 relational tables with foreign-key indexes and `initPlan`-optimized RLS policies calling `private.*` helpers.
3. **Supabase Realtime:**
   - `supabase_realtime` publication streams `postgres_changes` for live attendance, participant admissions, chat messages, meeting state, announcements, and notifications.
   - Private Realtime channels (`meeting:<id>:rtc`) authorize WebRTC Broadcast & Presence through `realtime.messages` RLS policies.
4. **Supabase Storage (`avatars` bucket):**
   - Stores uploaded employee profile photos (`EmployeesPage.tsx` and `SettingsPage.tsx`) under size/MIME validation (`5 MB`, `image/jpeg | png | webp | gif`) and per-user/admin RLS policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE` for upserts).
5. **Edge Functions (Deno):**
   - Keep secret keys (`SUPABASE_SECRET_KEYS` / `SUPABASE_SERVICE_ROLE_KEY`) strictly on Supabase servers while verifying caller JWTs inside each privileged handler.
