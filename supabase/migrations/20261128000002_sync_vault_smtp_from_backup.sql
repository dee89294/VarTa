-- =============================================================================
-- Migration: 20261128000002_sync_vault_smtp_from_backup.sql
-- Purpose: Syncs the verified working SMTP settings and Vault password
--   from `backup_pre_varta_refactor.platform_settings` into
--   `private.runtime_mail_config` + Supabase Vault (`varta_smtp_pass`).
-- =============================================================================

do $$
declare
  rec record;
  v_secret_id uuid;
  v_clean_pass text;
begin
  if to_regclass('backup_pre_varta_refactor.platform_settings') is null then
    return;
  end if;

  select
    smtp_enabled,
    smtp_host,
    smtp_port,
    smtp_user,
    smtp_pass,
    smtp_secure,
    smtp_from_email,
    smtp_from_name
  into rec
  from backup_pre_varta_refactor.platform_settings
  limit 1;

  if not found or coalesce(rec.smtp_enabled, false) is false then
    return;
  end if;

  v_clean_pass := replace(coalesce(rec.smtp_pass, ''), ' ', '');

  if v_clean_pass <> '' then
    select id into v_secret_id
    from vault.secrets
    where name = 'varta_smtp_pass'
    limit 1;

    if v_secret_id is not null then
      perform vault.update_secret(v_secret_id, v_clean_pass);
    else
      perform vault.create_secret(v_clean_pass, 'varta_smtp_pass', 'SMTP secret synced for VarTa runtime mail');
    end if;
  end if;

  update private.runtime_mail_config
  set
    smtp_host = coalesce(nullif(trim(rec.smtp_host), ''), smtp_host),
    smtp_port = coalesce(rec.smtp_port, smtp_port),
    smtp_user = coalesce(nullif(trim(rec.smtp_user), ''), smtp_user),
    smtp_secure = coalesce(rec.smtp_secure, smtp_secure),
    smtp_from_email = coalesce(nullif(trim(rec.smtp_from_email), ''), smtp_from_email),
    smtp_from_name = coalesce(nullif(trim(rec.smtp_from_name), ''), smtp_from_name),
    smtp_pass_secret_name = 'varta_smtp_pass',
    updated_at = now()
  where id = 1;
end $$;
