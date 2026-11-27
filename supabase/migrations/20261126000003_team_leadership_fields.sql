-- Migration mirror: 20261126000003_team_leadership_fields.sql
-- Purpose: Adds dynamic Team & Leadership classification (`member_category`), explicit `display_order`,
--   and social profile links (`linkedin_url`, `twitter_url`, `website_url`) to `public.employees`.
-- Connected files:
--   - `src/types/database.ts` (`MemberCategory`, `Employee`)
--   - `src/pages/TeamsPage.tsx` (partitions Founders/Leadership above Employees grid)
--   - `src/pages/EmployeesPage.tsx` & `supabase/functions/admin-manage-users/index.ts` (Admin CRUD)

alter table public.employees
  add column if not exists member_category text not null default 'employee'
    check (member_category in ('founder', 'co_founder', 'director', 'leadership', 'employee')),
  add column if not exists display_order integer not null default 100
    check (display_order >= 0),
  add column if not exists linkedin_url text not null default '',
  add column if not exists twitter_url text not null default '',
  add column if not exists website_url text not null default '';

create index if not exists employees_category_order_idx
  on public.employees (member_category, display_order, employee_code);

create or replace function private.protect_employee_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.is_super_admin() then
    if new.id is distinct from old.id
      or new.auth_user_id is distinct from old.auth_user_id
      or new.employee_code is distinct from old.employee_code
      or new.email is distinct from old.email
      or new.full_name is distinct from old.full_name
      or new.department_id is distinct from old.department_id
      or new.team_id is distinct from old.team_id
      or new.designation is distinct from old.designation
      or new.status is distinct from old.status
      or new.intended_role is distinct from old.intended_role
      or new.date_of_joining is distinct from old.date_of_joining
      or new.invited_at is distinct from old.invited_at
      or new.registered_at is distinct from old.registered_at
      or new.created_by is distinct from old.created_by
      or new.member_category is distinct from old.member_category
      or new.display_order is distinct from old.display_order
    then
      raise exception 'Only Super Admin can modify protected employee directory fields';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'employees'
  ) then
    alter publication supabase_realtime add table public.employees;
  end if;
end $$;
