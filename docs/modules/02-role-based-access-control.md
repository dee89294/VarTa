# Module 02: Role-Based Access Control (RBAC)

## Roles Defined
1. **`super_admin`**: Full platform governance — employee onboarding/editing/deactivation, organizer promotion/demotion, department/team management, viewing all meetings and company-wide reports, and editing `platform_settings`.
2. **`organizer`**: Schedules meetings, selects authorized participants, starts/ends/reschedules/cancels own meetings, manages waiting room & live participants, views live attendance, and exports CSV/Excel reports.
3. **`employee`**: Views personal dashboard, views invited meetings, joins authorized calls, views own attendance records, browses team directory, and updates permitted personal profile fields (`phone`, `bio`, `avatar_url`).

## Multi-Layer Enforcement
RBAC is never enforced solely in React UI; it is enforced across **four layers**:
1. **Database Storage (`public.user_roles`):** Authoritative role table managed only by Super Admins and server Edge Functions (`app_metadata` synced alongside it; mutable `user_metadata` is never trusted for authorization).
2. **Private SQL Helpers (`private.*`):** `private.current_role()`, `private.is_super_admin()`, `private.is_organizer_or_admin()` inspect `user_roles` joined with active `employees`.
3. **PostgreSQL Row Level Security & Column Trigger:**
   - RLS restricts `SELECT`/`INSERT`/`UPDATE`/`DELETE` across all 13 tables by role.
   - `private.protect_employee_columns()` rejects non-Super-Admin attempts to alter `intended_role`, `status`, `employee_code`, `email`, `department_id`, or `team_id`.
4. **UI Navigation & Edge Functions:**
   - `AppShell.tsx` filters sidebar navigation items by `role`.
   - `admin-manage-users` checks `role === 'super_admin'` server-side; `meeting-access` verifies organizer/admin privileges before mutating meetings or admitting/removing participants.

## Connected Files
- `supabase/migrations/20261126000001_initial_varta_schema.sql`
- `src/contexts/AuthContext.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/ui/StatusBadge.tsx` (`RoleBadge`)
- `supabase/functions/admin-manage-users/index.ts`
- `supabase/functions/meeting-access/index.ts`
