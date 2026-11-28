-- =============================================================================
-- Migration: 20261128000003_meeting_dashboard_workspace.sql
-- Purpose: Adds Meeting Summary (`description`, `agenda`, `discussion_points`),
--   Recording state tracking (`recording_status`, `recording_started_at`),
--   collaborative `public.meeting_tasks`, and persistent `public.meeting_messages`
--   for the redesigned LiveKit Meeting Workspace.
-- =============================================================================

alter table public.meetings
  add column if not exists description text not null default '',
  add column if not exists agenda text not null default '',
  add column if not exists discussion_points text not null default '',
  add column if not exists recording_status text not null default 'idle',
  add column if not exists recording_started_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meetings_recording_status_check'
  ) then
    alter table public.meetings
      add constraint meetings_recording_status_check
      check (recording_status in ('idle', 'recording', 'paused'));
  end if;
end $$;

create table if not exists public.meeting_tasks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  title text not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  is_completed boolean not null default false,
  assigned_to text not null default '',
  due_date date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  participant_identity text not null,
  sender_name text not null,
  sender_role text not null check (sender_role in ('organizer', 'registered', 'guest')),
  message_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists meeting_tasks_meeting_idx on public.meeting_tasks (meeting_id, created_at asc);
create index if not exists meeting_messages_meeting_idx on public.meeting_messages (meeting_id, created_at asc);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'touch_meeting_tasks_updated_at'
  ) then
    create trigger touch_meeting_tasks_updated_at
      before update on public.meeting_tasks
      for each row execute function private.touch_updated_at();
  end if;
end $$;

grant select, insert, update, delete on
  public.meeting_tasks,
  public.meeting_messages
to authenticated;

grant select, insert, update, delete on
  public.meeting_tasks,
  public.meeting_messages
to service_role;

alter table public.meeting_tasks enable row level security;
alter table public.meeting_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_tasks' and policyname = 'View tasks in authorized meetings'
  ) then
    create policy "View tasks in authorized meetings"
      on public.meeting_tasks for select to authenticated
      using (
        (select private.is_varta_organizer(meeting_id))
        or (select private.is_varta_invited_user(meeting_id))
        or (select private.is_varta_participant(meeting_id))
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_tasks' and policyname = 'Authorized users manage meeting tasks'
  ) then
    create policy "Authorized users manage meeting tasks"
      on public.meeting_tasks for all to authenticated
      using (
        (select private.is_varta_organizer(meeting_id))
        or (select private.is_varta_participant(meeting_id))
      )
      with check (
        (select private.is_varta_organizer(meeting_id))
        or (select private.is_varta_participant(meeting_id))
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_messages' and policyname = 'View messages in authorized meetings'
  ) then
    create policy "View messages in authorized meetings"
      on public.meeting_messages for select to authenticated
      using (
        (select private.is_varta_organizer(meeting_id))
        or (select private.is_varta_participant(meeting_id))
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_messages' and policyname = 'Authorized participants insert messages'
  ) then
    create policy "Authorized participants insert messages"
      on public.meeting_messages for insert to authenticated
      with check (
        user_id = (select auth.uid())
        and (
          (select private.is_varta_organizer(meeting_id))
          or (select private.is_varta_participant(meeting_id))
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_tasks'
  ) then
    alter publication supabase_realtime add table public.meeting_tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_messages'
  ) then
    alter publication supabase_realtime add table public.meeting_messages;
  end if;
end $$;
