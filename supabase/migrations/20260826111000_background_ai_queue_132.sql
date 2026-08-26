-- Project Octopus 1.3.2 — autonomous background AI queue.
-- Hosted Supabase wakes the production worker every 5 minutes, even when no user has the app open.
-- The wake token is generated at migration time and stored only in Supabase Vault.

create or replace function public.verify_background_worker_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matches boolean := false;
begin
  if p_token is null or length(trim(p_token)) < 32 then
    return false;
  end if;

  if to_regnamespace('vault') is null then
    return false;
  end if;

  execute $sql$
    select exists (
      select 1
      from vault.decrypted_secrets
      where name = 'octopus_background_worker_token'
        and decrypted_secret = $1
    )
  $sql$
  into v_matches
  using trim(p_token);

  return coalesce(v_matches, false);
exception
  when others then
    return false;
end;
$$;

revoke all on function public.verify_background_worker_token(text) from public, anon, authenticated;
grant execute on function public.verify_background_worker_token(text) to service_role;

-- pg_cron and pg_net are hosted-Supabase extensions. Local/PGlite migration validation
-- can safely skip activation when an extension is unavailable.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      execute 'create extension if not exists pg_net';
    exception when others then
      raise notice 'Project Octopus 1.3.2: pg_net activation skipped: %', sqlerrm;
    end;
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      execute 'create extension if not exists pg_cron';
    exception when others then
      raise notice 'Project Octopus 1.3.2: pg_cron activation skipped: %', sqlerrm;
    end;
  end if;
end;
$$;

-- Generate the scheduler credential only inside the database. It is never committed to Git.
do $$
declare
  v_secret_exists boolean := false;
  v_secret_id uuid;
  v_token text;
begin
  if to_regnamespace('vault') is not null then
    execute $sql$
      select exists (
        select 1
        from vault.decrypted_secrets
        where name = 'octopus_background_worker_token'
      )
    $sql$
    into v_secret_exists;

    if not v_secret_exists then
      v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      execute 'select vault.create_secret($1, $2, $3)'
        into v_secret_id
        using v_token,
              'octopus_background_worker_token',
              'Project Octopus 1.3.2 background AI queue wake token';
    end if;
  end if;
end;
$$;

-- Wake the queue every 5 minutes. claim_next_processing_job() still enforces
-- available_at <= now(), so Gemini cooldowns are never bypassed.
do $$
declare
  v_existing_job bigint;
begin
  if to_regnamespace('cron') is not null
     and to_regnamespace('net') is not null
     and to_regnamespace('vault') is not null then

    execute 'select jobid from cron.job where jobname = $1 order by jobid desc limit 1'
      into v_existing_job
      using 'octopus-background-ai-queue-132';

    if v_existing_job is not null then
      execute 'select cron.unschedule($1)' using v_existing_job;
    end if;

    execute $schedule$
      select cron.schedule(
        'octopus-background-ai-queue-132',
        '*/5 * * * *',
        $job$
          select net.http_post(
            url := 'https://project-octopus-alpha.vercel.app/api/brain/worker?limit=3',
            body := '{}'::jsonb,
            params := '{}'::jsonb,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'X-Octopus-Background-Token', (
                select decrypted_secret
                from vault.decrypted_secrets
                where name = 'octopus_background_worker_token'
                limit 1
              )
            ),
            timeout_milliseconds := 120000
          ) as request_id;
        $job$
      )
    $schedule$;
  else
    raise notice 'Project Octopus 1.3.2: background cron not scheduled because cron/net/vault is unavailable in this environment.';
  end if;
end;
$$;
