-- =============================================================================
-- Migration: 20261126000001_initial_varta_schema.sql
-- Project: VarTa Enterprise Meeting & Employee Management Platform
-- Purpose: Complete PostgreSQL schema, foreign key indexes, integrity triggers,
--   private SECURITY DEFINER RLS helpers, Row Level Security policies,
--   Supabase Storage `avatars` bucket policies, and Realtime authorization.
--
-- Connected Backend Edge Functions:
--   - `supabase/functions/employee-registration/index.ts` (reads/updates `employees`, inserts `user_roles`, `notifications`)
--   - `supabase/functions/admin-manage-users/index.ts` (writes `employees`, `user_roles`, `notifications`)
--   - `supabase/functions/meeting-access/index.ts` (enforces entry & writes `meetings`, `meeting_participants`, `attendance`, `notifications`, `meeting_activity_logs`, `meeting_messages`)
--
-- Connected Frontend Modules:
--   - `src/types/database.ts` mirrors every table interface below.
--   - `src/contexts/AuthContext.tsx` queries `employees` & `user_roles`.
--   - All pages in `src/pages/*` query/subscribe under the RLS policies below.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Private Helper Schema (isolated from PostgREST Data API exposure)
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Organizational Structure & Workforce Tables
-- -----------------------------------------------------------------------------

-- Table: public.departments
-- Purpose: Top-level company organizational divisions (e.g., Engineering, Product & Design).
-- Used by: `EmployeesPage.tsx`, `TeamsPage.tsx`, `ScheduleMeetingPage.tsx`, `AttendancePage.tsx`, `ReportsPage.tsx`.
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  description text not null default '',
  head_employee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Table: public.teams
-- Purpose: Sub-teams belonging to a department (`department_id` -> `departments.id`).
-- Used by: `TeamsPage.tsx`, `EmployeesPage.tsx`, `ScheduleMeetingPage.tsx`, `AttendancePage.tsx`.
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  description text not null default '',
  lead_employee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

-- Table: public.employees
-- Purpose: Master HR directory record for every employee, invited hire, organizer, and Super Admin.
-- Security: `auth_user_id` links to Supabase Auth (`auth.users.id`) ONLY after verified registration or admin provisioning.
-- Used by: `AuthContext.tsx`, `RegisterPage.tsx` (via Edge Function), `EmployeesPage.tsx`, `TeamsPage.tsx`,
--   `ScheduleMeetingPage.tsx`, `LiveMeetingPage.tsx`, `SettingsPage.tsx`.
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  employee_code text not null unique check (employee_code ~ '^[A-Z0-9_-]{3,20}$'),
  full_name text not null,
  email text not null unique check (email = lower(trim(email))),
  phone text not null default '',
  department_id uuid references public.departments(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  designation text not null,
  avatar_url text,
  bio text not null default '',
  status text not null default 'invited' check (status in ('invited', 'active', 'inactive')),
  intended_role text not null default 'employee' check (intended_role in ('super_admin', 'organizer', 'employee')),
  date_of_joining date not null default current_date,
  invited_at timestamptz not null default now(),
  registered_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.departments
  add constraint departments_head_employee_fkey
  foreign key (head_employee_id) references public.employees(id) on delete set null;

alter table public.teams
  add constraint teams_lead_employee_fkey
  foreign key (lead_employee_id) references public.employees(id) on delete set null;

-- Table: public.user_roles
-- Purpose: Authoritative RBAC role mapping (`super_admin`, `organizer`, `employee`) enforced by RLS.
-- Used by: `AuthContext.tsx`, `private.current_role()`, `admin-manage-users`, `employee-registration`, `meeting-access`.
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  role text not null check (role in ('super_admin', 'organizer', 'employee')),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3. Meetings, Authorization, Attendance, Chat, Agenda & Notifications
-- -----------------------------------------------------------------------------

-- Table: public.meetings
-- Purpose: Scheduled, live, completed, and cancelled meetings locked on the company calendar.
-- Used by: `DashboardPage.tsx`, `ScheduleMeetingPage.tsx`, `CalendarPage.tsx`, `MyMeetingsPage.tsx`, `LiveMeetingPage.tsx`, `ReportsPage.tsx`.
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_code text not null unique,
  title text not null,
  description text not null default '',
  organizer_id uuid not null references public.employees(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 480),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'completed', 'cancelled')),
  waiting_room_enabled boolean not null default false,
  is_locked boolean not null default true,
  allow_chat boolean not null default true,
  allow_screen_share boolean not null default true,
  actual_started_at timestamptz,
  actual_ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end > scheduled_start)
);

-- Table: public.meeting_participants
-- Purpose: Strict invite allowlist & waiting-room admission state for each meeting.
-- Connected files: `ScheduleMeetingPage.tsx` (creates), `LiveMeetingPage.tsx` (renders & admits),
--   `meeting-access` Edge Function (verifies `join` & updates `admission_status`).
create table public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role_in_meeting text not null default 'participant' check (role_in_meeting in ('organizer', 'participant')),
  admission_status text not null default 'invited' check (admission_status in ('invited', 'waiting', 'admitted', 'rejected', 'removed')),
  invited_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, employee_id)
);

-- Table: public.attendance
-- Purpose: Verified attendance ledger per `(meeting_id, employee_id)` storing status (`waiting`, `present`, `absent`),
--   `verified_entry`, `join_time`, `leave_time`, heartbeat timestamps, and accumulated `total_duration_seconds`.
-- Connected files: `meeting-access` Edge Function (authoritative writer), `LiveMeetingPage.tsx`, `AttendancePage.tsx`, `ReportsPage.tsx`, `DashboardPage.tsx`.
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  status text not null default 'absent' check (status in ('waiting', 'present', 'absent')),
  join_time timestamptz,
  leave_time timestamptz,
  last_heartbeat_at timestamptz,
  total_duration_seconds integer not null default 0 check (total_duration_seconds >= 0),
  verified_entry boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (meeting_id, employee_id)
);

-- Table: public.meeting_messages
-- Purpose: Persisted real-time chat & system events scoped exclusively to admitted meeting participants.
-- Connected files: `LiveMeetingPage.tsx` (sends/receives via RLS + Realtime).
create table public.meeting_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sender_employee_id uuid not null references public.employees(id) on delete cascade,
  sender_name text not null,
  sender_code text not null,
  content text not null check (char_length(trim(content)) > 0),
  message_type text not null default 'text' check (message_type in ('text', 'system', 'reaction')),
  created_at timestamptz not null default now()
);

-- Table: public.meeting_agenda
-- Purpose: Ordered meeting talking points (`position`, `title`, `duration_minutes`, `presenter_name`, `is_completed`).
-- Connected files: `ScheduleMeetingPage.tsx` (creates), `CalendarPage.tsx`, `LiveMeetingPage.tsx` (live checklist).
create table public.meeting_agenda (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  position integer not null default 1,
  title text not null,
  duration_minutes integer not null default 10 check (duration_minutes > 0),
  presenter_name text not null default '',
  is_completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Table: public.notifications
-- Purpose: Per-employee real-time notifications (invites, reschedules, cancellations, waiting room, join/leave, end).
-- Connected files: `AppShell.tsx` (Realtime dropdown & unread counter), `ScheduleMeetingPage.tsx`, `CalendarPage.tsx`, `meeting-access`.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_employee_id uuid not null references public.employees(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Table: public.announcements
-- Purpose: Company-wide announcements shown on `DashboardPage.tsx`, authored by Super Admins or Organizers.
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  priority text not null default 'info' check (priority in ('info', 'important', 'urgent')),
  author_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Table: public.meeting_activity_logs
-- Purpose: Immutable meeting audit log (scheduled, started, joined, left, ended) displayed on `DashboardPage.tsx`.
create table public.meeting_activity_logs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  actor_employee_id uuid references public.employees(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Table: public.platform_settings
-- Purpose: Singleton organization governance policy row (`id = 1`) editable by Super Admins on `SettingsPage.tsx`.
create table public.platform_settings (
  id integer primary key default 1 check (id = 1),
  company_name text not null default 'VarTa',
  default_waiting_room boolean not null default false,
  prevent_double_booking boolean not null default true,
  attendance_grace_minutes integer not null default 10,
  allow_employee_directory boolean not null default true,
  updated_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Foreign Key & Composite Query Indexes
-- -----------------------------------------------------------------------------
create index departments_head_employee_idx on public.departments (head_employee_id);
create index teams_department_id_idx on public.teams (department_id);
create index teams_lead_employee_idx on public.teams (lead_employee_id);

create index employees_auth_user_id_idx on public.employees (auth_user_id);
create index employees_department_id_idx on public.employees (department_id);
create index employees_team_id_idx on public.employees (team_id);
create index employees_status_idx on public.employees (status);
create index employees_created_by_idx on public.employees (created_by);

create index user_roles_user_id_idx on public.user_roles (user_id);
create index user_roles_employee_id_idx on public.user_roles (employee_id);
create index user_roles_assigned_by_idx on public.user_roles (assigned_by);

create index meetings_organizer_id_idx on public.meetings (organizer_id);
create index meetings_department_id_idx on public.meetings (department_id);
create index meetings_team_id_idx on public.meetings (team_id);
create index meetings_status_start_idx on public.meetings (status, scheduled_start);
create index meetings_start_end_idx on public.meetings (scheduled_start, scheduled_end);

create index meeting_participants_meeting_id_idx on public.meeting_participants (meeting_id);
create index meeting_participants_employee_id_idx on public.meeting_participants (employee_id);
create index meeting_participants_invited_by_idx on public.meeting_participants (invited_by);

create index attendance_meeting_id_idx on public.attendance (meeting_id);
create index attendance_employee_id_status_idx on public.attendance (employee_id, status);

create index meeting_messages_meeting_created_idx on public.meeting_messages (meeting_id, created_at);
create index meeting_messages_sender_idx on public.meeting_messages (sender_employee_id);

create index meeting_agenda_meeting_pos_idx on public.meeting_agenda (meeting_id, position);

create index notifications_recipient_unread_idx on public.notifications (recipient_employee_id, is_read, created_at desc);
create index notifications_meeting_id_idx on public.notifications (meeting_id);

create index announcements_author_idx on public.announcements (author_employee_id);
create index announcements_created_idx on public.announcements (created_at desc);

create index meeting_activity_meeting_idx on public.meeting_activity_logs (meeting_id, created_at desc);
create index meeting_activity_actor_idx on public.meeting_activity_logs (actor_employee_id);
create index platform_settings_updated_by_idx on public.platform_settings (updated_by);

-- -----------------------------------------------------------------------------
-- 5. Timestamp Triggers & Private RLS Security Helpers
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_departments_updated_at before update on public.departments for each row execute function private.touch_updated_at();
create trigger touch_teams_updated_at before update on public.teams for each row execute function private.touch_updated_at();
create trigger touch_employees_updated_at before update on public.employees for each row execute function private.touch_updated_at();
create trigger touch_user_roles_updated_at before update on public.user_roles for each row execute function private.touch_updated_at();
create trigger touch_meetings_updated_at before update on public.meetings for each row execute function private.touch_updated_at();
create trigger touch_meeting_participants_updated_at before update on public.meeting_participants for each row execute function private.touch_updated_at();
create trigger touch_attendance_updated_at before update on public.attendance for each row execute function private.touch_updated_at();
create trigger touch_platform_settings_updated_at before update on public.platform_settings for each row execute function private.touch_updated_at();

-- Helper functions executed inside RLS policies (initPlan-cached via `(select ...)`).
create or replace function private.current_employee_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e
  where e.auth_user_id = (select auth.uid()) and e.status = 'active'
  limit 1;
$$;

create or replace function private.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select ur.role from public.user_roles ur
  join public.employees e on e.id = ur.employee_id
  where ur.user_id = (select auth.uid()) and e.status = 'active'
  limit 1;
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_role() = 'super_admin', false);
$$;

create or replace function private.is_organizer_or_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_role() in ('super_admin', 'organizer'), false);
$$;

create or replace function private.is_meeting_organizer(p_meeting_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id and m.organizer_id = private.current_employee_id()
  );
$$;

create or replace function private.is_meeting_participant(p_meeting_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id
      and mp.employee_id = private.current_employee_id()
      and mp.admission_status in ('invited', 'waiting', 'admitted')
  );
$$;

create or replace function private.is_admitted_to_meeting(p_meeting_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_meeting_organizer(p_meeting_id)
    or exists (
      select 1 from public.meeting_participants mp
      where mp.meeting_id = p_meeting_id
        and mp.employee_id = private.current_employee_id()
        and mp.admission_status = 'admitted'
    );
$$;

-- Authorizes private Realtime WebSocket channels (`meeting:<uuid>:rtc`, `user:<uuid>:notifications`).
create or replace function private.can_access_realtime_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[];
  v_target_id uuid;
begin
  if (select auth.uid()) is null then return false; end if;
  v_parts := string_to_array(p_topic, ':');
  if array_length(v_parts, 1) < 2 then return false; end if;
  begin
    v_target_id := v_parts[2]::uuid;
  exception when others then
    return false;
  end;
  if v_parts[1] = 'meeting' then
    if coalesce(v_parts[3], '') = 'waiting' then
      return private.is_meeting_organizer(v_target_id) or private.is_meeting_participant(v_target_id);
    end if;
    return private.is_admitted_to_meeting(v_target_id);
  elsif v_parts[1] = 'user' then
    return v_target_id = private.current_employee_id();
  end if;
  return false;
end;
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.current_employee_id() to authenticated;
grant execute on function private.current_role() to authenticated;
grant execute on function private.is_super_admin() to authenticated;
grant execute on function private.is_organizer_or_admin() to authenticated;
grant execute on function private.is_meeting_organizer(uuid) to authenticated;
grant execute on function private.is_meeting_participant(uuid) to authenticated;
grant execute on function private.is_admitted_to_meeting(uuid) to authenticated;
grant execute on function private.can_access_realtime_topic(text) to authenticated;

-- Prevents employees/organizers from escalating roles or altering protected HR directory columns via API.
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
    then
      raise exception 'Only Super Admin can modify protected employee directory fields';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_employee_columns_trg
  before update on public.employees
  for each row execute function private.protect_employee_columns();

-- Security-invoker calendar overlap query helper + integrity trigger enforcing locked/double-booked slots.
create or replace function public.check_meeting_conflicts(
  p_organizer_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_participant_ids uuid[] default '{}',
  p_exclude_meeting_id uuid default null
)
returns table (
  conflict_type text,
  meeting_id uuid,
  meeting_title text,
  meeting_code text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  affected_employee_ids uuid[]
)
language sql stable security invoker set search_path = '' as $$
  with overlapping as (
    select m.id, m.title, m.meeting_code, m.organizer_id, m.scheduled_start, m.scheduled_end
    from public.meetings m
    where m.status in ('scheduled', 'live')
      and (p_exclude_meeting_id is null or m.id <> p_exclude_meeting_id)
      and tstzrange(m.scheduled_start, m.scheduled_end, '[)') && tstzrange(p_start, p_end, '[)')
  )
  select
    case when o.organizer_id = p_organizer_id then 'organizer_conflict' else 'participant_conflict' end as conflict_type,
    o.id as meeting_id,
    o.title as meeting_title,
    o.meeting_code,
    o.scheduled_start,
    o.scheduled_end,
    array_remove(array_agg(distinct mp.employee_id) filter (
      where mp.employee_id = any(p_participant_ids) or mp.employee_id = p_organizer_id
    ), null) as affected_employee_ids
  from overlapping o
  left join public.meeting_participants mp on mp.meeting_id = o.id
  where (select auth.uid()) is not null
    and (
      o.organizer_id = p_organizer_id
      or o.organizer_id = any(p_participant_ids)
      or mp.employee_id = any(p_participant_ids)
      or mp.employee_id = p_organizer_id
    )
  group by o.id, o.title, o.meeting_code, o.organizer_id, o.scheduled_start, o.scheduled_end;
$$;

revoke execute on function public.check_meeting_conflicts(uuid, timestamptz, timestamptz, uuid[], uuid) from public, anon;
grant execute on function public.check_meeting_conflicts(uuid, timestamptz, timestamptz, uuid[], uuid) to authenticated;

create or replace function private.enforce_meeting_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_prevent boolean;
  v_conflict_exists boolean;
begin
  new.scheduled_end := new.scheduled_start + make_interval(mins => new.duration_minutes);
  if tg_op = 'UPDATE' then
    if old.status in ('completed', 'cancelled') and not private.is_super_admin() then
      raise exception 'Completed or cancelled meetings are locked and cannot be modified';
    end if;
  end if;
  if new.status in ('scheduled', 'live') then
    select coalesce(ps.prevent_double_booking, true) into v_prevent from public.platform_settings ps where ps.id = 1;
    if v_prevent and (tg_op = 'INSERT' or new.scheduled_start is distinct from old.scheduled_start or new.scheduled_end is distinct from old.scheduled_end) then
      select exists (
        select 1 from public.meetings m
        where m.id <> new.id and m.organizer_id = new.organizer_id and m.status in ('scheduled', 'live')
          and tstzrange(m.scheduled_start, m.scheduled_end, '[)') && tstzrange(new.scheduled_start, new.scheduled_end, '[)')
      ) into v_conflict_exists;
      if v_conflict_exists then
        raise exception 'Calendar conflict: Organizer already has another active or scheduled meeting overlapping this time slot';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_meeting_integrity_trg
  before insert or update on public.meetings
  for each row execute function private.enforce_meeting_integrity();

-- -----------------------------------------------------------------------------
-- 6. Grants, RLS Enablement & Policies
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on public.departments, public.teams, public.employees, public.user_roles, public.meetings, public.meeting_participants, public.attendance, public.meeting_messages, public.meeting_agenda, public.notifications, public.announcements, public.meeting_activity_logs, public.platform_settings to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

alter table public.departments enable row level security;
alter table public.teams enable row level security;
alter table public.employees enable row level security;
alter table public.user_roles enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.attendance enable row level security;
alter table public.meeting_messages enable row level security;
alter table public.meeting_agenda enable row level security;
alter table public.notifications enable row level security;
alter table public.announcements enable row level security;
alter table public.meeting_activity_logs enable row level security;
alter table public.platform_settings enable row level security;

-- Policies enforce role-scoped isolation across all 13 tables:
create policy "Active users can view departments" on public.departments for select to authenticated using ((select private.current_employee_id()) is not null);
create policy "Super admins manage departments" on public.departments for all to authenticated using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy "Active users can view teams" on public.teams for select to authenticated using ((select private.current_employee_id()) is not null);
create policy "Super admins manage teams" on public.teams for all to authenticated using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy "Directory visibility by role" on public.employees for select to authenticated
  using ((select private.is_super_admin()) or id = (select private.current_employee_id()) or ((select private.current_employee_id()) is not null and status = 'active'));
create policy "Super admins insert employees" on public.employees for insert to authenticated with check ((select private.is_super_admin()));
create policy "Super admins or self update permitted employee fields" on public.employees for update to authenticated
  using ((select private.is_super_admin()) or id = (select private.current_employee_id()))
  with check ((select private.is_super_admin()) or id = (select private.current_employee_id()));
create policy "Super admins delete employees" on public.employees for delete to authenticated using ((select private.is_super_admin()));

create policy "Users view own role and admins view all" on public.user_roles for select to authenticated using (user_id = (select auth.uid()) or (select private.is_super_admin()));
create policy "Super admins manage roles" on public.user_roles for all to authenticated using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy "View authorized meetings" on public.meetings for select to authenticated
  using ((select private.is_super_admin()) or organizer_id = (select private.current_employee_id()) or (select private.is_meeting_participant(id)));
create policy "Organizers and super admins schedule meetings" on public.meetings for insert to authenticated
  with check ((select private.is_super_admin()) or ((select private.current_role()) = 'organizer' and organizer_id = (select private.current_employee_id())));
create policy "Meeting organizer or super admin can update" on public.meetings for update to authenticated
  using ((select private.is_super_admin()) or organizer_id = (select private.current_employee_id()))
  with check ((select private.is_super_admin()) or organizer_id = (select private.current_employee_id()));
create policy "Meeting organizer or super admin can delete" on public.meetings for delete to authenticated
  using ((select private.is_super_admin()) or organizer_id = (select private.current_employee_id()));

create policy "View meeting participants for authorized meetings" on public.meeting_participants for select to authenticated
  using ((select private.is_super_admin()) or employee_id = (select private.current_employee_id()) or (select private.is_meeting_organizer(meeting_id)) or (select private.is_meeting_participant(meeting_id)));
create policy "Organizer or super admin manages meeting participants" on public.meeting_participants for insert to authenticated with check ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id)));
create policy "Organizer or super admin updates meeting participants" on public.meeting_participants for update to authenticated using ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id))) with check ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id)));
create policy "Organizer or super admin removes meeting participants" on public.meeting_participants for delete to authenticated using ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id)));

create policy "Attendance read scoped by role" on public.attendance for select to authenticated
  using ((select private.is_super_admin()) or employee_id = (select private.current_employee_id()) or (select private.is_meeting_organizer(meeting_id)));
create policy "Organizer or super admin inserts attendance" on public.attendance for insert to authenticated with check ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id)));
create policy "Organizer or super admin updates attendance" on public.attendance for update to authenticated using ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id))) with check ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id)));

create policy "Admitted participants read chat" on public.meeting_messages for select to authenticated using ((select private.is_super_admin()) or (select private.is_admitted_to_meeting(meeting_id)));
create policy "Admitted participants send chat" on public.meeting_messages for insert to authenticated with check (sender_employee_id = (select private.current_employee_id()) and ((select private.is_admitted_to_meeting(meeting_id)) or (select private.is_super_admin())));

create policy "Authorized meeting viewers read agenda" on public.meeting_agenda for select to authenticated using ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id)) or (select private.is_meeting_participant(meeting_id)));
create policy "Organizer or super admin manages agenda" on public.meeting_agenda for all to authenticated using ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id))) with check ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id)));

create policy "Employees read own notifications" on public.notifications for select to authenticated using (recipient_employee_id = (select private.current_employee_id()) or (select private.is_super_admin()));
create policy "Organizers and super admins send meeting notifications" on public.notifications for insert to authenticated with check ((select private.is_super_admin()) or ((select private.is_organizer_or_admin()) and (meeting_id is null or (select private.is_meeting_organizer(meeting_id)))));
create policy "Recipients update read state" on public.notifications for update to authenticated using (recipient_employee_id = (select private.current_employee_id())) with check (recipient_employee_id = (select private.current_employee_id()));
create policy "Recipients delete own notifications" on public.notifications for delete to authenticated using (recipient_employee_id = (select private.current_employee_id()) or (select private.is_super_admin()));

create policy "Active users view announcements" on public.announcements for select to authenticated using ((select private.current_employee_id()) is not null);
create policy "Super admins and organizers manage announcements" on public.announcements for all to authenticated using ((select private.is_organizer_or_admin())) with check ((select private.is_organizer_or_admin()));

create policy "View meeting activity logs" on public.meeting_activity_logs for select to authenticated using ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id)) or (select private.is_meeting_participant(meeting_id)));
create policy "Organizers and super admins log activity" on public.meeting_activity_logs for insert to authenticated with check ((select private.is_super_admin()) or (select private.is_meeting_organizer(meeting_id)));

create policy "Active users read platform settings" on public.platform_settings for select to authenticated using ((select private.current_employee_id()) is not null);
create policy "Super admins update platform settings" on public.platform_settings for update to authenticated using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

-- -----------------------------------------------------------------------------
-- 7. Supabase Storage (`avatars` bucket) & Realtime Publication + Policies
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Avatar images readable by authenticated and public"
  on storage.objects for select
  using (bucket_id = 'avatars' and storage.allow_any_operation(array['object.get_authenticated_info', 'object.get_authenticated']));
create policy "Users upload own avatar or admin uploads any"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_super_admin())));
create policy "Users update own avatar or admin updates any"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_super_admin())))
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_super_admin())));
create policy "Users delete own avatar or admin deletes any"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_super_admin())));

alter publication supabase_realtime add table
  public.meetings, public.meeting_participants, public.attendance,
  public.meeting_messages, public.meeting_agenda, public.notifications, public.announcements;

create policy "Authorized users receive private realtime"
  on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and (select private.can_access_realtime_topic((select realtime.topic()))));

create policy "Authorized users publish private realtime"
  on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and (select private.can_access_realtime_topic((select realtime.topic()))));
