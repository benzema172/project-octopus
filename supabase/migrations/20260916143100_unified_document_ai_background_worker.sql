-- Proactive Unified Document AI worker.
-- Reuses the existing Project Octopus background token stored in Supabase Vault.
-- The worker prepares recommendations only; it never performs financial decisions without an authorized actor.

do $$
declare
  v_existing_job bigint;
begin
  if to_regnamespace('cron') is not null
     and to_regnamespace('net') is not null
     and to_regnamespace('vault') is not null then

    execute 'select jobid from cron.job where jobname = $1 order by jobid desc limit 1'
      into v_existing_job
      using 'octopus-finance-ai-copilot-200';

    if v_existing_job is not null then
      execute 'select cron.unschedule($1)' using v_existing_job;
    end if;

    execute $schedule$
      select cron.schedule(
        'octopus-finance-ai-copilot-200',
        '*/10 * * * *',
        $job$
          select net.http_post(
            url := 'https://project-octopus-alpha.vercel.app/api/company/unified-document-ai/worker?limit=2',
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
    raise notice 'Unified Document AI worker: cron/net/vault unavailable, schedule skipped.';
  end if;
end;
$$;
