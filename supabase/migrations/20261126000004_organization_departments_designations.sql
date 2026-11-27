-- Migration: 20261126000004_organization_departments_designations.sql
-- Purpose: Integrates dynamic Organization Management (Departments, Designations, Employee Categories,
--   Employee Social Links) and Meeting Multi-Department/Email Invitation fields into VarTa without
--   breaking existing users, authentication credentials, or historical meeting/attendance records.
-- Connected files:
--   - `src/types/database.ts` (`Department`, `Designation`, `EmployeeCategoryOption`, `EmployeeSocialLink`, `Employee`)
--   - `supabase/functions/admin-manage-users/index.ts` & `supabase/functions/meeting-access/index.ts`
--   - `src/components/admin/*`, `src/pages/EmployeesPage.tsx`, `src/pages/TeamsPage.tsx`, `src/pages/ScheduleMeetingPage.tsx`

-- -----------------------------------------------------------------------------
-- 1. Extend public.departments with dynamic status & display_order
-- -----------------------------------------------------------------------------
alter table public.departments
  add column if not exists display_order integer not null default 100 check (display_order >= 0),
  add column if not exists is_active boolean not null default true;

create index if not exists departments_active_order_idx
  on public.departments (is_active, display_order, name);

-- Realign existing 4 seed departments while preserving their UUIDs for historical meetings & teams
update public.departments
set name = 'Management',
    code = 'MGT',
    display_order = 1,
    is_active = true,
    description = 'Executive leadership, corporate governance, strategic direction, and client relations'
where id = '4a66c663-cad0-4b8f-9036-794d76882b09';

update public.departments
set name = 'Audio Visual (AV)',
    code = 'AV',
    display_order = 3,
    is_active = true,
    description = 'Audio visual systems design, smart conferencing rooms, hardware integration, and AV support'
where id = '1bf34958-2a59-455c-bfdd-e615f1c56049';

update public.departments
set name = 'Projects & Engineering',
    code = 'PRJ',
    display_order = 4,
    is_active = true,
    description = 'Engineering delivery, technical architecture, turnkey project execution, and management'
where id = '3ca21f68-632f-4a4d-ae65-1087abbe97eb';

update public.departments
set name = 'Business Development',
    code = 'BD',
    display_order = 7,
    is_active = true,
    description = 'Enterprise growth, strategic partnerships, proposals, and client acquisition'
where id = '53f08f28-76a2-4fad-9d4c-62f552b86e50';

insert into public.departments (name, code, display_order, is_active, description)
values
  ('Management', 'MGT', 1, true, 'Executive leadership, corporate governance, strategic direction, and client relations'),
  ('IT & Networking', 'ITN', 2, true, 'Enterprise IT infrastructure, network engineering, cybersecurity, and workstation support'),
  ('Audio Visual (AV)', 'AV', 3, true, 'Audio visual systems design, smart conferencing rooms, hardware integration, and AV support'),
  ('Projects & Engineering', 'PRJ', 4, true, 'Engineering delivery, technical architecture, turnkey project execution, and management'),
  ('Supply Chain Management (SCM)', 'SCM', 5, true, 'Procurement, vendor operations, inventory logistics, and supply chain coordination'),
  ('Accounts & Finance', 'FIN', 6, true, 'Financial accounting, billing compliance, budgeting, and vendor settlements'),
  ('Business Development', 'BD', 7, true, 'Enterprise growth, strategic partnerships, proposals, and client acquisition'),
  ('Human Resources (HR)', 'HR', 8, true, 'Talent acquisition, people operations, culture, and workforce governance')
on conflict (code) do update
  set display_order = excluded.display_order,
      is_active = true;

-- -----------------------------------------------------------------------------
-- 2. Employee Categories Catalog (7 canonical hierarchy levels)
-- -----------------------------------------------------------------------------
create table if not exists public.employee_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  tier_group text not null check (tier_group in ('founders_md', 'director_leadership', 'department_heads', 'managers', 'employees')),
  hierarchy_rank integer not null,
  card_scale text not null check (card_scale in ('large', 'medium', 'compact')),
  description text not null default '',
  created_at timestamptz not null default now()
);

insert into public.employee_categories (slug, name, tier_group, hierarchy_rank, card_scale, description)
values
  ('founder', 'Founder', 'founders_md', 10, 'large', 'Company founders leading long-term vision'),
  ('managing_director', 'Managing Director', 'founders_md', 20, 'large', 'Managing Director overseeing overall company execution'),
  ('director', 'Director', 'director_leadership', 30, 'large', 'Associate Director & Executive Directors'),
  ('leadership', 'Leadership', 'director_leadership', 40, 'large', 'Senior Leadership steering key company functions'),
  ('department_head', 'Department Head', 'department_heads', 50, 'medium', 'Heads leading individual company departments'),
  ('manager', 'Manager', 'managers', 60, 'medium', 'Project Managers and functional managers'),
  ('employee', 'Employee', 'employees', 70, 'compact', 'Specialists, engineers, executives, and team members')
on conflict (slug) do update
  set name = excluded.name,
      tier_group = excluded.tier_group,
      hierarchy_rank = excluded.hierarchy_rank,
      card_scale = excluded.card_scale,
      description = excluded.description;

-- -----------------------------------------------------------------------------
-- 3. Designations Catalog (department-scoped, hierarchical, reusable)
-- -----------------------------------------------------------------------------
create table if not exists public.designations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  title text not null,
  description text not null default '',
  hierarchy_level integer not null default 50 check (hierarchy_level >= 1 and hierarchy_level <= 999),
  default_category text not null default 'employee' check (
    default_category in ('founder', 'managing_director', 'director', 'leadership', 'department_head', 'manager', 'employee')
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, title)
);

create index if not exists designations_dept_hierarchy_idx
  on public.designations (department_id, hierarchy_level, title);

create or replace trigger touch_designations_updated_at
  before update on public.designations
  for each row execute function private.touch_updated_at();

with dept_map as (
  select id, code from public.departments
),
seed_rows(dept_code, title, hierarchy_level, default_category, description) as (
  values
    ('MGT', 'Managing Director', 10, 'managing_director', 'Executive head responsible for strategic governance and growth'),
    ('MGT', 'Associate Director', 20, 'director', 'Senior executive overseeing cross-department delivery and operations'),
    ('MGT', 'Head of Client Relations & SCM', 30, 'leadership', 'Executive leadership for key client accounts and supply chain strategy'),
    ('ITN', 'Network Engineer', 50, 'employee', 'Designs, secures, and maintains enterprise networking systems'),
    ('ITN', 'IT Technician', 60, 'employee', 'Handles workstation setup, hardware diagnostics, and IT helpdesk support'),
    ('AV', 'AV Engineer', 50, 'employee', 'Designs and commissions integrated conference room audio-visual systems'),
    ('AV', 'AV Technician', 60, 'employee', 'Installs, tests, and supports live room AV hardware and cabling'),
    ('PRJ', 'Manager', 35, 'manager', 'Coordinates engineering teams, milestones, and technical governance'),
    ('PRJ', 'Project Manager', 40, 'manager', 'Owns end-to-end project schedules, quality delivery, and client handoff'),
    ('PRJ', 'Project Engineer', 50, 'employee', 'Executes technical deployment, testing, and field engineering'),
    ('PRJ', 'Project Executive', 60, 'employee', 'Supports project coordination, documentation, and site schedules'),
    ('SCM', 'Assistant Manager – SCM', 40, 'manager', 'Manages procurement workflows, vendor coordination, and logistics timelines'),
    ('SCM', 'Senior Executive – SCM', 50, 'employee', 'Executes sourcing, purchase orders, and inventory tracking'),
    ('FIN', 'Accounts Executive', 50, 'employee', 'Manages invoicing, ledgers, reconciliations, and statutory compliance'),
    ('BD', 'Business Development Executive', 50, 'employee', 'Drives client outreach, enterprise proposals, and commercial growth'),
    ('HR', 'Head of HR', 30, 'department_head', 'Leads talent strategy, onboarding governance, and people operations'),
    ('HR', 'Senior Executive', 50, 'employee', 'Supports recruitment, employee engagement, and HR administration')
)
insert into public.designations (department_id, title, hierarchy_level, default_category, description, is_active)
select dm.id, sr.title, sr.hierarchy_level, sr.default_category, sr.description, true
from seed_rows sr
join dept_map dm on dm.code = sr.dept_code
on conflict (department_id, title) do update
  set hierarchy_level = excluded.hierarchy_level,
      default_category = excluded.default_category,
      is_active = true;

-- -----------------------------------------------------------------------------
-- 4. Upgrade public.employees organizational links (zero-downtime additive columns)
-- -----------------------------------------------------------------------------
alter table public.employees
  add column if not exists designation_id uuid references public.designations(id) on delete set null,
  add column if not exists category_id uuid references public.employee_categories(id) on delete set null,
  add column if not exists org_category text not null default 'employee' check (
    org_category in ('founder', 'managing_director', 'director', 'leadership', 'department_head', 'manager', 'employee')
  );

create index if not exists employees_designation_id_idx on public.employees (designation_id);
create index if not exists employees_category_id_idx on public.employees (category_id);
create index if not exists employees_org_category_idx on public.employees (org_category, display_order);

-- Synchronizes designation <-> designation_id and category_id <-> org_category <-> member_category
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

create or replace trigger sync_employee_org_links_trg
  before insert or update on public.employees
  for each row execute function private.sync_employee_org_links();

with dept_lookup as (
  select code, id from public.departments
),
des_lookup as (
  select d.id, d.title, dp.code as dept_code
  from public.designations d
  join public.departments dp on dp.id = d.department_id
)
update public.employees e
set
  department_id = case e.employee_code
    when 'EMP001' then (select id from dept_lookup where code = 'MGT')
    when 'EMP003' then (select id from dept_lookup where code = 'MGT')
    when 'EMP002' then (select id from dept_lookup where code = 'PRJ')
    when 'EMP007' then (select id from dept_lookup where code = 'MGT')
    when 'EMP004' then (select id from dept_lookup where code = 'PRJ')
    when 'EMP005' then (select id from dept_lookup where code = 'ITN')
    when 'EMP006' then (select id from dept_lookup where code = 'HR')
    when 'EMP008' then (select id from dept_lookup where code = 'BD')
    when 'EMP009' then (select id from dept_lookup where code = 'AV')
    when 'EMP010' then (select id from dept_lookup where code = 'FIN')
    else e.department_id
  end,
  designation_id = case e.employee_code
    when 'EMP001' then (select id from des_lookup where dept_code = 'MGT' and title = 'Managing Director')
    when 'EMP003' then (select id from des_lookup where dept_code = 'MGT' and title = 'Associate Director')
    when 'EMP002' then (select id from des_lookup where dept_code = 'PRJ' and title = 'Project Manager')
    when 'EMP007' then (select id from des_lookup where dept_code = 'MGT' and title = 'Head of Client Relations & SCM')
    when 'EMP004' then (select id from des_lookup where dept_code = 'PRJ' and title = 'Manager')
    when 'EMP005' then (select id from des_lookup where dept_code = 'ITN' and title = 'Network Engineer')
    when 'EMP006' then (select id from des_lookup where dept_code = 'HR' and title = 'Head of HR')
    when 'EMP008' then (select id from des_lookup where dept_code = 'BD' and title = 'Business Development Executive')
    when 'EMP009' then (select id from des_lookup where dept_code = 'AV' and title = 'AV Engineer')
    when 'EMP010' then (select id from des_lookup where dept_code = 'FIN' and title = 'Accounts Executive')
    else e.designation_id
  end,
  org_category = case e.employee_code
    when 'EMP001' then 'founder'
    when 'EMP003' then 'director'
    when 'EMP007' then 'leadership'
    when 'EMP002' then 'department_head'
    when 'EMP006' then 'department_head'
    when 'EMP004' then 'manager'
    else coalesce(nullif(e.org_category, ''), 'employee')
  end
where e.employee_code in ('EMP001','EMP002','EMP003','EMP004','EMP005','EMP006','EMP007','EMP008','EMP009','EMP010');

update public.departments d
set head_employee_id = (select id from public.employees where employee_code = 'EMP006' limit 1)
where d.code = 'HR' and d.head_employee_id is null;

update public.teams
set department_id = (select id from public.departments where code = 'HR' limit 1)
where name = 'Talent & Workplace';

update public.teams
set department_id = (select id from public.departments where code = 'ITN' limit 1)
where name = 'Cloud & Security';

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

-- -----------------------------------------------------------------------------
-- 5. Employee Social Links table + backfill
-- -----------------------------------------------------------------------------
create table if not exists public.employee_social_links (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'twitter', 'website', 'github', 'other')),
  url text not null check (char_length(trim(url)) > 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, platform)
);

create index if not exists employee_social_links_emp_idx
  on public.employee_social_links (employee_id);

create or replace trigger touch_employee_social_links_updated_at
  before update on public.employee_social_links
  for each row execute function private.touch_updated_at();

insert into public.employee_social_links (employee_id, platform, url, is_primary)
select id, 'linkedin', linkedin_url, true from public.employees where coalesce(trim(linkedin_url), '') <> ''
on conflict (employee_id, platform) do update set url = excluded.url;

insert into public.employee_social_links (employee_id, platform, url, is_primary)
select id, 'twitter', twitter_url, false from public.employees where coalesce(trim(twitter_url), '') <> ''
on conflict (employee_id, platform) do update set url = excluded.url;

insert into public.employee_social_links (employee_id, platform, url, is_primary)
select id, 'website', website_url, false from public.employees where coalesce(trim(website_url), '') <> ''
on conflict (employee_id, platform) do update set url = excluded.url;

-- -----------------------------------------------------------------------------
-- 6. Meetings & Meeting Participants Multi-Dept & Email Invitations
-- -----------------------------------------------------------------------------
alter table public.meetings
  add column if not exists invited_department_ids uuid[] not null default '{}';

alter table public.meeting_participants
  add column if not exists invitation_source text not null default 'individual'
    check (invitation_source in ('individual', 'department', 'department_heads', 'managers', 'leadership')),
  add column if not exists invited_email text not null default '',
  add column if not exists invitation_sent_at timestamptz;

update public.meeting_participants mp
set invited_email = e.email,
    invitation_sent_at = coalesce(mp.invitation_sent_at, mp.created_at)
from public.employees e
where e.id = mp.employee_id
  and coalesce(mp.invited_email, '') = '';

create or replace function private.prevent_inactive_meeting_invite()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_email text;
begin
  select e.status, e.email into v_status, v_email
  from public.employees e
  where e.id = new.employee_id;

  if v_status = 'inactive' then
    raise exception 'Inactive employees cannot be invited to meetings';
  end if;

  if coalesce(trim(new.invited_email), '') = '' and v_email is not null then
    new.invited_email := v_email;
  end if;
  if new.invitation_sent_at is null then
    new.invitation_sent_at := now();
  end if;
  return new;
end;
$$;

create or replace trigger prevent_inactive_meeting_invite_trg
  before insert on public.meeting_participants
  for each row execute function private.prevent_inactive_meeting_invite();

-- -----------------------------------------------------------------------------
-- 7. Protect In-Use Departments & Designations from Deletion
-- -----------------------------------------------------------------------------
create or replace function private.prevent_in_use_department_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.employees e
    where e.department_id = old.id and e.status in ('active', 'invited')
  ) then
    raise exception 'Cannot delete department "%" because active or pending employees are assigned to it. Reassign those employees first.', old.name;
  end if;
  return old;
end;
$$;

create or replace trigger prevent_in_use_department_delete_trg
  before delete on public.departments
  for each row execute function private.prevent_in_use_department_delete();

create or replace function private.prevent_in_use_designation_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.employees e
    where e.designation_id = old.id and e.status in ('active', 'invited')
  ) then
    raise exception 'Cannot delete designation "%" because active or pending employees currently hold this role. Reassign them first.', old.title;
  end if;
  return old;
end;
$$;

create or replace trigger prevent_in_use_designation_delete_trg
  before delete on public.designations
  for each row execute function private.prevent_in_use_designation_delete();

-- -----------------------------------------------------------------------------
-- 8. Grants, RLS Policies & Realtime Publication
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.designations, public.employee_social_links to authenticated;
grant select on public.employee_categories to authenticated;
grant select, insert, update, delete on public.designations, public.employee_categories, public.employee_social_links to service_role;

alter table public.designations enable row level security;
alter table public.employee_categories enable row level security;
alter table public.employee_social_links enable row level security;

create policy "Authenticated active staff view categories" on public.employee_categories
  for select to authenticated using ((select private.current_employee_id()) is not null);

create policy "Active users view designations" on public.designations
  for select to authenticated using ((select private.current_employee_id()) is not null);
create policy "Super admins insert designations" on public.designations
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "Super admins update designations" on public.designations
  for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));
create policy "Super admins delete designations" on public.designations
  for delete to authenticated using ((select private.is_super_admin()));

create policy "Active users view social links" on public.employee_social_links
  for select to authenticated using ((select private.current_employee_id()) is not null);
create policy "Super admins or self insert social links" on public.employee_social_links
  for insert to authenticated
  with check ((select private.is_super_admin()) or employee_id = (select private.current_employee_id()));
create policy "Super admins or self update social links" on public.employee_social_links
  for update to authenticated
  using ((select private.is_super_admin()) or employee_id = (select private.current_employee_id()))
  with check ((select private.is_super_admin()) or employee_id = (select private.current_employee_id()));
create policy "Super admins or self delete social links" on public.employee_social_links
  for delete to authenticated
  using ((select private.is_super_admin()) or employee_id = (select private.current_employee_id()));

do $$
declare
  tbl text;
begin
  foreach tbl in array array['departments', 'designations', 'employee_categories', 'employee_social_links'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;
