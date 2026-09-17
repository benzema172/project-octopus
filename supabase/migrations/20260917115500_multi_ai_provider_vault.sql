-- Multi-AI provider credentials stored in Supabase Vault.
-- Only server-side service_role may read/write decrypted provider secrets.

create or replace function public.set_multi_ai_provider_secret(
  p_workspace_id uuid,
  p_provider text,
  p_secret text,
  p_account_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_secret text := trim(coalesce(p_secret, ''));
  v_name text;
  v_existing uuid;
  v_account_name text;
  v_account_existing uuid;
begin
  if p_workspace_id is null then
    raise exception 'workspace_id is required';
  end if;
  if v_provider not in ('groq', 'cloudflare') then
    raise exception 'unsupported provider: %', v_provider;
  end if;
  if length(v_secret) < 8 then
    raise exception 'provider secret is too short';
  end if;

  v_name := format('octopus_multi_ai_%s_%s', v_provider, p_workspace_id::text);
  select id into v_existing from vault.secrets where name = v_name limit 1;

  if v_existing is null then
    perform vault.create_secret(v_secret, v_name, format('Project Octopus Multi-AI %s credential', v_provider));
  else
    perform vault.update_secret(v_existing, v_secret, v_name, format('Project Octopus Multi-AI %s credential', v_provider));
  end if;

  if v_provider = 'cloudflare' and nullif(trim(coalesce(p_account_id, '')), '') is not null then
    v_account_name := format('octopus_multi_ai_cloudflare_account_%s', p_workspace_id::text);
    select id into v_account_existing from vault.secrets where name = v_account_name limit 1;
    if v_account_existing is null then
      perform vault.create_secret(trim(p_account_id), v_account_name, 'Project Octopus Cloudflare Account ID');
    else
      perform vault.update_secret(v_account_existing, trim(p_account_id), v_account_name, 'Project Octopus Cloudflare Account ID');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'provider', v_provider);
end;
$$;

create or replace function public.delete_multi_ai_provider_secret(
  p_workspace_id uuid,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_name text;
  v_account_name text;
begin
  if p_workspace_id is null then
    raise exception 'workspace_id is required';
  end if;
  if v_provider not in ('groq', 'cloudflare') then
    raise exception 'unsupported provider: %', v_provider;
  end if;

  v_name := format('octopus_multi_ai_%s_%s', v_provider, p_workspace_id::text);
  delete from vault.secrets where name = v_name;

  if v_provider = 'cloudflare' then
    v_account_name := format('octopus_multi_ai_cloudflare_account_%s', p_workspace_id::text);
    delete from vault.secrets where name = v_account_name;
  end if;

  return jsonb_build_object('ok', true, 'provider', v_provider);
end;
$$;

create or replace function public.get_multi_ai_provider_secrets(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, vault, pg_temp
as $$
declare
  v_groq text;
  v_cloudflare text;
  v_cloudflare_account text;
begin
  if p_workspace_id is null then
    raise exception 'workspace_id is required';
  end if;

  select decrypted_secret into v_groq
  from vault.decrypted_secrets
  where name = format('octopus_multi_ai_groq_%s', p_workspace_id::text)
  limit 1;

  select decrypted_secret into v_cloudflare
  from vault.decrypted_secrets
  where name = format('octopus_multi_ai_cloudflare_%s', p_workspace_id::text)
  limit 1;

  select decrypted_secret into v_cloudflare_account
  from vault.decrypted_secrets
  where name = format('octopus_multi_ai_cloudflare_account_%s', p_workspace_id::text)
  limit 1;

  return jsonb_build_object(
    'groqApiKey', v_groq,
    'cloudflareApiToken', v_cloudflare,
    'cloudflareAccountId', v_cloudflare_account
  );
end;
$$;

revoke all on function public.set_multi_ai_provider_secret(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.delete_multi_ai_provider_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.get_multi_ai_provider_secrets(uuid) from public, anon, authenticated;

grant execute on function public.set_multi_ai_provider_secret(uuid, text, text, text) to service_role;
grant execute on function public.delete_multi_ai_provider_secret(uuid, text) to service_role;
grant execute on function public.get_multi_ai_provider_secrets(uuid) to service_role;
