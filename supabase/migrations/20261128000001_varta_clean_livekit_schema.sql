-- =============================================================================
-- Migration: 20261128000001_varta_clean_livekit_schema.sql
-- Purpose: Safely backs up legacy HR/enterprise data, migrates valid Auth users
--   and meetings into a streamlined Google-Meet-style schema (`profiles`,
--   `meetings`, `meeting_invitations`, `meeting_participants`), removes unused
--   company/employee/department/team structures, and enables LiveKit-ready RLS.
-- Security:
--   - Preserves `auth.users`, `private.runtime_mail_config`, and `public.get_smtp_runtime_config()`.
--   - Stores backup snapshots under `backup_pre_varta_refactor` (locked from client API).
--   - Blocks `anon` table access; validates guest/invitation tokens strictly in Edge Functions.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Pre-Cleanup Safety Backup Schema (zero PostgREST/client access)
-- -----------------------------------------------------------------------------
create schema if not exists backup_pre_varta_refactor;
revoke all on schema backup_pre_varta_refactor from public, anon, authenticated;

do $$
declare
  tbl text;
  legacy_tables text[] := array[
    'employees',
    'user_roles',
    'departments',
    'teams',
    'designations',
    'employee_categories',
    'employee_social_links',
    'meetings',
    'meeting_participants',
    'attendance',
    'meeting_messages',
    'meeting_agenda',
    'notifications',
    'announcements',
    'meeting_activity_logs',
    'platform_settings'
  ];
begin
  foreach tbl in array legacy_tables loop
    if to_regclass('public.' || tbl) is not null
       and to_regclass('backup_pre_varta_refactor.' || tbl) is null then
      execute format(
        'create table backup_pre_varta_refactor.%I as select * from public.%I',
        tbl,
        tbl
      );
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Stage Legacy Auth Profiles & Useful Meetings Before Dropping Old Tables
-- -----------------------------------------------------------------------------
create temp table if not exists _staged_profiles (
  id uuid primary key,
  full_name text not null,
  email text not null,
  created_at timestamptz not null default now()
) on commit drop;

do $$
begin
  if to_regclass('public.employees') is not null then
    insert into _staged_profiles (id, full_name, email, created_at)
    select
      au.id,
      coalesce(
        nullif(trim(e.full_name), ''),
        nullif(trim(au.raw_user_meta_data->>'full_name'), ''),
        split_part(au.email, '@', 1)
      ),
      lower(trim(au.email)),
      coalesce(au.created_at, now())
    from auth.users au
    left join public.employees e on e.auth_user_id = au.id
    where coalesce(trim(au.email), '') <> ''
    on conflict (id) do nothing;
  else
    insert into _staged_profiles (id, full_name, email, created_at)
    select
      au.id,
      coalesce(nullif(trim(au.raw_user_meta_data->>'full_name'), ''), split_part(au.email, '@', 1)),
      lower(trim(au.email)),
      coalesce(au.created_at, now())
    from auth.users au
    where coalesce(trim(au.email), '') <> ''
    on conflict (id) do nothing;
  end if;
end $$;

create temp table if not exists _staged_meetings (
  id uuid primary key,
  meeting_code text not null,
  meeting_title text not null,
  organizer_id uuid not null,
  meeting_status text not null,
  waiting_room_enabled boolean not null default false,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
) on commit drop;

do $$
begin
  if to_regclass('public.meetings') is not null and to_regclass('public.employees') is not null then
    insert into _staged_meetings (
      id, meeting_code, meeting_title, organizer_id, meeting_status,
      waiting_room_enabled, scheduled_at, started_at, ended_at, created_at
    )
    select
      m.id,
      lower(m.meeting_code),
      m.title,
      e.auth_user_id,
      case m.status
        when 'live' then 'active'
        when 'completed' then 'ended'
        when 'cancelled' then 'cancelled'
        else 'scheduled'
      end,
      coalesce(m.waiting_room_enabled, false),
      m.scheduled_start,
      m.actual_started_at,
      m.actual_ended_at,
      m.created_at
    from public.meetings m
    join public.employees e on e.id = m.organizer_id
    where e.auth_user_id is not null
    on conflict (id) do nothing;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Remove Unused HR / Company Structures (preserving vault + runtime mail)
-- -----------------------------------------------------------------------------
drop policy if exists "Authorized users receive private realtime" on realtime.messages;
drop policy if exists "Authorized users publish private realtime" on realtime.messages;

drop trigger if exists on_auth_user_created_profile on auth.users;
drop function if exists public.check_meeting_conflicts(uuid, timestamptz, timestamptz, uuid[], uuid) cascade;

drop table if exists
  public.attendance,
  public.notifications,
  public.announcements,
  public.meeting_agenda,
  public.meeting_activity_logs,
  public.meeting_messages,
  public.meeting_participants,
  public.meeting_invitations,
  public.meetings,
  public.employee_social_links,
  public.designations,
  public.employee_categories,
  public.teams,
  public.departments,
  public.platform_settings,
  public.user_roles,
  public.employees
cascade;

drop function if exists private.protect_employee_columns() cascade;
drop function if exists private.sync_employee_org_links() cascade;
drop function if exists private.prevent_in_use_department_delete() cascade;
drop function if exists private.prevent_in_use_designation_delete() cascade;
drop function if exists private.prevent_inactive_meeting_invite() cascade;
drop function if exists private.enforce_meeting_integrity() cascade;
drop function if exists private.current_employee_id() cascade;
drop function if exists private.current_role() cascade;
drop function if exists private.is_super_admin() cascade;
drop function if exists private.is_organizer_or_admin() cascade;
drop function if exists private.is_meeting_organizer(uuid) cascade;
drop function if exists private.is_meeting_participant(uuid) cascade;
drop function if exists private.is_admitted_to_meeting(uuid) cascade;
drop function if exists private.can_access_realtime_topic(text) cascade;

-- -----------------------------------------------------------------------------
-- 4. Minimal Core Tables for VARTA Meetings
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique check (email = lower(trim(email))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profiles (id, full_name, email, created_at)
select id, full_name, email, created_at from _staged_profiles
on conflict (id) do update
  set full_name = excluded.full_name,
      email = excluded.email;

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_code text not null unique,
  meeting_title text not null,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  meeting_status text not null default 'scheduled'
    check (meeting_status in ('scheduled', 'active', 'ended', 'cancelled')),
  is_instant boolean not null default false,
  waiting_room_enabled boolean not null default false,
  share_token_hash text not null default encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.meetings (
  id, meeting_code, meeting_title, organizer_id, meeting_status,
  waiting_room_enabled, scheduled_at, started_at, ended_at, created_at
)
select
  id, meeting_code, meeting_title, organizer_id, meeting_status,
  waiting_room_enabled, scheduled_at, started_at, ended_at, created_at
from _staged_meetings
on conflict (id) do nothing;

create table public.meeting_invitations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  invitee_email text not null check (invitee_email = lower(trim(invitee_email))),
  secure_invitation_token_hash text not null unique,
  invitation_status text not null default 'pending'
    check (invitation_status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, invitee_email)
);

create table public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  full_name text not null,
  email text check (email is null or email = lower(trim(email))),
  participant_type text not null check (participant_type in ('organizer', 'registered', 'guest')),
  participant_identity text not null,
  admission_status text not null default 'admitted' check (admission_status in ('waiting', 'admitted', 'removed')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, participant_identity)
);

create index meetings_organizer_created_idx on public.meetings (organizer_id, created_at desc);
create index meetings_code_idx on public.meetings (meeting_code);
create index meeting_invitations_meeting_idx on public.meeting_invitations (meeting_id);
create index meeting_invitations_email_idx on public.meeting_invitations (invitee_email);
create index meeting_participants_meeting_idx on public.meeting_participants (meeting_id);
create index meeting_participants_user_idx on public.meeting_participants (user_id);

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_profiles_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

create trigger touch_meetings_updated_at
  before update on public.meetings
  for each row execute function private.touch_updated_at();

create trigger touch_meeting_invitations_updated_at
  before update on public.meeting_invitations
  for each row execute function private.touch_updated_at();

create trigger touch_meeting_participants_updated_at
  before update on public.meeting_participants
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Automatic Profile Creation on User Sign Up (`auth.users` -> `public.profiles`)
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(trim(new.email), '') <> '' then
    insert into public.profiles (id, full_name, email)
    values (
      new.id,
      coalesce(
        nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
        split_part(trim(new.email), '@', 1)
      ),
      lower(trim(new.email))
    )
    on conflict (id) do update
      set full_name = excluded.full_name,
          email = excluded.email;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 6. RLS Security Helpers & Tight Policies (zero anon table access)
-- -----------------------------------------------------------------------------
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_varta_organizer(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id and m.organizer_id = (select auth.uid())
  );
$$;

create or replace function private.is_varta_invited_user(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meeting_invitations mi
    where mi.meeting_id = p_meeting_id
      and mi.invitee_email = lower(coalesce((select auth.jwt()->>'email'), ''))
      and mi.invitation_status <> 'revoked'
  );
$$;

create or replace function private.is_varta_participant(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id
      and mp.user_id = (select auth.uid())
      and mp.admission_status <> 'removed'
  );
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_varta_organizer(uuid) to authenticated, service_role;
grant execute on function private.is_varta_invited_user(uuid) to authenticated, service_role;
grant execute on function private.is_varta_participant(uuid) to authenticated, service_role;
grant execute on function private.touch_updated_at() to authenticated, service_role;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on
  public.profiles,
  public.meetings,
  public.meeting_invitations,
  public.meeting_participants
to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_invitations enable row level security;
alter table public.meeting_participants enable row level security;

-- Profiles: users manage their own profile and can view organizers of meetings they can access
create policy "Users view own profile or visible meeting organizer"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.meetings m
      where m.organizer_id = profiles.id
        and (
          (select private.is_varta_invited_user(m.id))
          or (select private.is_varta_participant(m.id))
        )
    )
  );

create policy "Users insert own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "Users update own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Meetings: authenticated organizers create/manage; invited/participating users can view
create policy "Authorized users view meetings"
  on public.meetings for select to authenticated
  using (
    organizer_id = (select auth.uid())
    or (select private.is_varta_invited_user(id))
    or (select private.is_varta_participant(id))
  );

create policy "Authenticated users create own meetings"
  on public.meetings for insert to authenticated
  with check (organizer_id = (select auth.uid()));

create policy "Only organizer updates meeting"
  on public.meetings for update to authenticated
  using (organizer_id = (select auth.uid()))
  with check (organizer_id = (select auth.uid()));

create policy "Only organizer deletes meeting"
  on public.meetings for delete to authenticated
  using (organizer_id = (select auth.uid()));

-- Meeting Invitations: only organizer creates/manages; matching email invitees can view their invite status
create policy "Organizer or invitee views meeting invitations"
  on public.meeting_invitations for select to authenticated
  using (
    (select private.is_varta_organizer(meeting_id))
    or invitee_email = lower(coalesce((select auth.jwt()->>'email'), ''))
  );

create policy "Organizer inserts invitations"
  on public.meeting_invitations for insert to authenticated
  with check ((select private.is_varta_organizer(meeting_id)));

create policy "Organizer updates invitations"
  on public.meeting_invitations for update to authenticated
  using ((select private.is_varta_organizer(meeting_id)))
  with check ((select private.is_varta_organizer(meeting_id)));

create policy "Organizer deletes invitations"
  on public.meeting_invitations for delete to authenticated
  using ((select private.is_varta_organizer(meeting_id)));

-- Meeting Participants: organizer and meeting participants can view; organizer manages removal/admission
create policy "View participants in authorized meetings"
  on public.meeting_participants for select to authenticated
  using (
    (select private.is_varta_organizer(meeting_id))
    or user_id = (select auth.uid())
    or (select private.is_varta_participant(meeting_id))
  );

create policy "Organizer updates participant state"
  on public.meeting_participants for update to authenticated
  using ((select private.is_varta_organizer(meeting_id)))
  with check ((select private.is_varta_organizer(meeting_id)));

create policy "Organizer removes participants"
  on public.meeting_participants for delete to authenticated
  using ((select private.is_varta_organizer(meeting_id)));

-- Publish meeting status changes to Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meetings'
  ) then
    alter publication supabase_realtime add table public.meetings;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_participants'
  ) then
    alter publication supabase_realtime add table public.meeting_participants;
  end if;
end $$;
