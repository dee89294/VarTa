-- Migration: 20261127000007_private_runtime_mail_config.sql
-- Purpose: Stores server-side mail & application URL runtime defaults in non-exposed schema `private`
--   with SMTP credentials encrypted in `vault.secrets`, readable ONLY via `service_role` RPC.
-- Security:
--   - `anon` and `authenticated` have zero privileges on `private.runtime_mail_config` or `vault.*`.
--   - `EXECUTE` on `public.get_smtp_runtime_config()` is revoked from `PUBLIC`, `anon`, and `authenticated`
--     and granted exclusively to `service_role`.

create schema if not exists private;
revoke all on schema private from public, anon;
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

create table if not exists private.runtime_mail_config (
  id smallint primary key default 1 check (id = 1),
  app_url text not null default 'http://localhost:5173',
  smtp_host text not null default '',
  smtp_port integer not null default 587,
  smtp_user text not null default '',
  smtp_pass_secret_name text not null default 'varta_smtp_pass',
  smtp_secure boolean not null default false,
  smtp_from_email text not null default '',
  smtp_from_name text not null default 'VarTa Meetings',
  updated_at timestamptz not null default now()
);

alter table private.runtime_mail_config enable row level security;

revoke all on table private.runtime_mail_config from public, anon, authenticated;
grant select, insert, update on table private.runtime_mail_config to service_role;

create or replace function public.get_smtp_runtime_config()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg private.runtime_mail_config%rowtype;
  decrypted_pass text := '';
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin')
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Forbidden: service_role privileges required';
  end if;

  select * into cfg
  from private.runtime_mail_config
  where id = 1;

  if not found then
    return jsonb_build_object(
      'app_url', '',
      'host', '',
      'port', 587,
      'user', '',
      'pass', '',
      'secure', false,
      'from_email', '',
      'from_name', 'VarTa Meetings'
    );
  end if;

  if coalesce(cfg.smtp_pass_secret_name, '') <> '' then
    select ds.decrypted_secret into decrypted_pass
    from vault.decrypted_secrets ds
    where ds.name = cfg.smtp_pass_secret_name
    limit 1;
  end if;

  return jsonb_build_object(
    'app_url', coalesce(cfg.app_url, ''),
    'host', coalesce(cfg.smtp_host, ''),
    'port', coalesce(cfg.smtp_port, 587),
    'user', coalesce(cfg.smtp_user, ''),
    'pass', coalesce(decrypted_pass, ''),
    'secure', coalesce(cfg.smtp_secure, false),
    'from_email', coalesce(cfg.smtp_from_email, ''),
    'from_name', coalesce(cfg.smtp_from_name, 'VarTa Meetings')
  );
end;
$$;

revoke all on function public.get_smtp_runtime_config() from public, anon, authenticated;
grant execute on function public.get_smtp_runtime_config() to service_role;
