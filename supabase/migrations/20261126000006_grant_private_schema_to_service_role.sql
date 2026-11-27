-- Migration: 20261126000006_grant_private_schema_to_service_role.sql
-- Purpose: Grants `USAGE` on schema `private` and `EXECUTE` on `private.*` functions to `service_role`.
-- Why required:
--   `service_role` in Supabase is NOT a Postgres superuser (`rolsuper = false`). Previously `schema private`
--   only granted `USAGE` and `EXECUTE` to `authenticated`, so server-side Edge Functions (`admin-manage-users`,
--   `employee-registration`, `meeting-access`) using `supabaseAdmin` hit `permission denied for schema private`
--   whenever `BEFORE INSERT/UPDATE/DELETE` triggers (`private.protect_employee_columns()`,
--   `private.enforce_meeting_integrity()`, etc.) evaluated `private.is_super_admin()` under the invoker role.
-- Security: `public` and `anon` remain completely blocked from schema `private`.

grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to service_role;
alter default privileges in schema private grant execute on functions to service_role;
