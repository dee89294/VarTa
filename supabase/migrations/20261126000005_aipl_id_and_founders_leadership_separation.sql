-- Migration: 20261126000005_aipl_id_and_founders_leadership_separation.sql
-- Purpose:
--   1. Adopts the company `AIPL-(numbers)` Employee ID format (e.g. AIPL-002, AIPL-003, ...) for all employees.
--   2. Separates Company Founding Members (`founder`, `managing_director`) out of Employee lists, Employee IDs,
--      and Employee counts via `is_founding_member = true` (stored exclusively as Leadership profiles).
-- Connected files:
--   - `src/lib/orgUtils.ts`, `src/types/database.ts`, `src/components/employees/EmployeeFormModal.tsx`
--   - `supabase/functions/admin-manage-users/index.ts`, `supabase/functions/employee-registration/index.ts`

-- 1. Add explicit is_founding_member flag to public.employees
alter table public.employees
  add column if not exists is_founding_member boolean not null default false;

create index if not exists employees_founding_status_idx
  on public.employees (is_founding_member, status);

-- 2. Update organization sync trigger to maintain is_founding_member & validate AIPL-(numbers) Employee IDs
create or replace function private.sync_employee_org_links()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_des_title text;
  v_cat_id uuid;
begin
  if new.designation_id is not null then
    select d.title into v_des_title
    from public.designations d
    where d.id = new.designation_id;
    if v_des_title is not null then
      new.designation := v_des_title;
    end if;
  elsif new.department_id is not null and coalesce(trim(new.designation), '') <> '' then
    select d.id into new.designation_id
    from public.designations d
    where d.department_id = new.department_id
      and lower(trim(d.title)) = lower(trim(new.designation))
    limit 1;
  end if;

  if coalesce(trim(new.org_category), '') = '' then
    new.org_category := case new.member_category
      when 'co_founder' then 'director'
      when 'founder' then 'founder'
      when 'director' then 'director'
      when 'leadership' then 'leadership'
      else 'employee'
    end;
  end if;

  new.member_category := case new.org_category
    when 'founder' then 'founder'
    when 'managing_director' then 'founder'
    when 'director' then 'director'
    when 'leadership' then 'leadership'
    else 'employee'
  end;

  new.is_founding_member := new.org_category in ('founder', 'managing_director');

  if new.is_founding_member then
    -- Founding members are Leadership-only and never carry an Employee AIPL ID
    if coalesce(trim(new.employee_code), '') = '' or new.employee_code ~ '^(EMP|AIPL-)' then
      new.employee_code := 'FOUNDER-' || upper(substr(replace(new.id::text, '-', ''), 1, 6));
    end if;
  else
    new.employee_code := upper(trim(new.employee_code));
    if new.employee_code !~ '^AIPL-[0-9]+$' then
      raise exception 'Employee ID must follow the AIPL-(numbers) format (e.g. AIPL-001).';
    end if;
  end if;

  select ec.id into v_cat_id
  from public.employee_categories ec
  where ec.slug = new.org_category
  limit 1;
  if v_cat_id is not null then
    new.category_id := v_cat_id;
  end if;

  return new;
end;
$$;

-- 3. Protect is_founding_member column from non-super-admin edits
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
      or new.designation_id is distinct from old.designation_id
      or new.category_id is distinct from old.category_id
      or new.org_category is distinct from old.org_category
      or new.is_founding_member is distinct from old.is_founding_member
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

-- 4. Migrate existing EMP codes to AIPL-(numbers) for employees and internal FOUNDER codes for founders
update public.employees
set employee_code = case
    when org_category in ('founder', 'managing_director') then 'FOUNDER-001'
    when employee_code ~ '^EMP[0-9]+$' then 'AIPL-' || substr(employee_code, 4)
    else employee_code
  end,
  is_founding_member = (org_category in ('founder', 'managing_director'));

-- Sync historical chat sender codes cleanly
update public.meeting_messages mm
set sender_code = case
    when e.is_founding_member then 'LEADERSHIP'
    else e.employee_code
  end
from public.employees e
where e.id = mm.sender_employee_id;
