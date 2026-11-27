# Module 01: Authentication & Verified Employee Registration

## Purpose
Ensures only employees pre-approved by a Super Admin can register for login credentials and access the workspace. Random self-signups with arbitrary emails or invented Employee IDs are rejected on the server.

## Connected Files
- `src/pages/LoginPage.tsx` — Email/password authentication UI.
- `src/pages/RegisterPage.tsx` — Two-step HR-verified registration UI.
- `src/contexts/AuthContext.tsx` — Resolves Auth user -> `public.employees` + `public.user_roles`.
- `src/lib/supabase.ts` — `supabase.auth` and `invokeEdgeFunction()`.
- `supabase/functions/employee-registration/index.ts` — Server-side verification & Auth user creation.
- Database tables: `auth.users`, `public.employees`, `public.user_roles`, `public.notifications`.

## Step-by-Step Working Flow
1. **HR Pre-Creation:** A Super Admin creates an employee record in `EmployeesPage.tsx` (`status = 'invited'`, `employee_code`, `email`, `intended_role`).
2. **Step 1 — Server Verification (`RegisterPage.tsx`):**
   - Employee enters their `Employee ID` and `Company Email`.
   - Frontend calls `invokeEdgeFunction('employee-registration', { action: 'verify', employee_code, email }, false)`.
   - The Edge Function uses elevated server credentials to query `public.employees` matching both `employee_code` and `email`.
   - If missing -> returns `404`. If `status === 'inactive'` -> `403`. If already linked to `auth_user_id` -> `409`.
3. **Step 2 — Credential Provisioning:**
   - Employee enters a password (min 8 chars) and optional phone number.
   - Edge Function (`action: 'register'`) re-verifies eligibility, creates the `auth.users` account via `auth.admin.createUser({ email_confirm: true, app_metadata: { role, employee_id, employee_code } })`, links `employees.auth_user_id`, flips `employees.status` to `'active'`, inserts into `public.user_roles`, and writes a welcome notification.
4. **Immediate Sign-In & Context Hydration:**
   - `RegisterPage.tsx` (or `LoginPage.tsx` for existing accounts) calls `supabase.auth.signInWithPassword()`, followed by `AuthContext.refreshProfile()`.
   - If an admin later deactivates the employee (`status = 'inactive'`), `AuthContext` blocks access and signs them out automatically.
