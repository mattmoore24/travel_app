-- A safe front door for the two Vault secrets the cron workers read.
--
-- vault.create_secret takes (value, name) — value FIRST — which is the reverse
-- of what everyone expects. Getting it backwards succeeds silently, names a
-- secret after the credential (and vault.secrets.name is NOT encrypted), and
-- leaves the lookup finding nothing. That footgun cost a debugging session, so
-- callers get this instead.
create or replace function public.set_worker_credentials(
  p_project_url text,
  p_service_role_key text
)
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url_len int;
  v_key_len int;
begin
  -- Shape checks that specifically catch the swap: a URL never looks like a
  -- JWT and a JWT never looks like a URL.
  if p_project_url is null or p_project_url !~ '^https://[a-z0-9-]+\.supabase\.(co|in)/?$' then
    raise exception
      'first argument must be the project URL, e.g. https://abcdefgh.supabase.co (got %)',
      left(coalesce(p_project_url, '<null>'), 24) || '…'
      using errcode = 'check_violation';
  end if;
  if p_service_role_key is null or p_service_role_key !~ '^eyJ' then
    raise exception
      'second argument must be the service_role key (a JWT starting "eyJ")'
      using errcode = 'check_violation';
  end if;

  -- Replace rather than update: a previous swapped call may have left the
  -- credential sitting in an unencrypted name column.
  delete from vault.secrets where name in ('project_url', 'service_role_key');
  perform vault.create_secret(rtrim(p_project_url, '/'), 'project_url');
  perform vault.create_secret(p_service_role_key, 'service_role_key');

  select length(decrypted_secret) into v_url_len
    from vault.decrypted_secrets where name = 'project_url';
  select length(decrypted_secret) into v_key_len
    from vault.decrypted_secrets where name = 'service_role_key';

  if v_url_len is null or v_key_len is null then
    raise exception 'secrets did not persist — vault may be unreadable by this role'
      using errcode = 'internal_error';
  end if;

  return format(
    'ok — project_url (%s chars) and service_role_key (%s chars) stored; '
    || 'workers post within a minute',
    v_url_len, v_key_len
  );
end
$$;

revoke all on function public.set_worker_credentials(text, text) from public, anon, authenticated;
