create or replace function public.recover_stale_processing_jobs(p_stale_after interval default interval '6 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with recovered as (
    update public.processing_jobs pj
    set status = 'queued',
        stage = case when pj.stage = 'complete' then 'extract' else pj.stage end,
        available_at = now(),
        locked_at = null,
        locked_by = null,
        last_heartbeat_at = null,
        error_code = 'STALE_WORKER_RECOVERED',
        error_message = 'Worker przekroczył czas działania lub utracił heartbeat. Zadanie zostało automatycznie wznowione; zapisane porcje AI pozostają w cache.',
        updated_at = now()
    where pj.status = 'running'
      and pj.attempt_count < pj.max_attempts
      and coalesce(pj.last_heartbeat_at, pj.locked_at, pj.updated_at) < now() - p_stale_after
    returning pj.document_version_id
  )
  select count(*) into v_count from recovered;

  if v_count > 0 then
    update public.documents d
    set ai_status = 'queued'
    where exists (
      select 1
      from public.document_versions dv
      join public.processing_jobs pj on pj.document_version_id = dv.id
      where dv.document_id = d.id
        and pj.status = 'queued'
        and pj.error_code = 'STALE_WORKER_RECOVERED'
    );

    update public.document_intakes di
    set status = 'queued'
    where exists (
      select 1
      from public.document_versions dv
      join public.processing_jobs pj on pj.document_version_id = dv.id
      where dv.document_id = di.document_id
        and pj.status = 'queued'
        and pj.error_code = 'STALE_WORKER_RECOVERED'
    );
  end if;

  return v_count;
end;
$$;

revoke all on function public.recover_stale_processing_jobs(interval) from public, anon, authenticated;
grant execute on function public.recover_stale_processing_jobs(interval) to service_role;

create or replace function public.run_background_ai_queue_tick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  perform public.recover_stale_processing_jobs(interval '6 minutes');

  -- Do not start another document worker while a healthy one still owns a job.
  if exists (
    select 1
    from public.processing_jobs pj
    where pj.status = 'running'
      and coalesce(pj.last_heartbeat_at, pj.locked_at, pj.updated_at) >= now() - interval '6 minutes'
  ) then
    return null;
  end if;

  if not exists (
    select 1
    from public.processing_jobs pj
    where pj.status = 'queued'
      and pj.available_at <= now()
      and pj.attempt_count < pj.max_attempts
  ) then
    return null;
  end if;

  select decrypted_secret
  into v_token
  from vault.decrypted_secrets
  where name = 'octopus_background_worker_token'
  limit 1;

  if v_token is null or length(v_token) < 32 then
    return null;
  end if;

  select net.http_post(
    url := 'https://project-octopus-alpha.vercel.app/api/brain/worker?limit=1',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Octopus-Background-Token', v_token
    ),
    timeout_milliseconds := 300000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.run_background_ai_queue_tick() from public, anon, authenticated;
grant execute on function public.run_background_ai_queue_tick() to service_role;

-- Replace the legacy 5-minute / limit=3 kick with a serialized 2-minute queue tick.
do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where jobname = 'octopus-background-ai-queue-132'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end;
$$;

select cron.schedule(
  'octopus-background-ai-queue-132',
  '*/2 * * * *',
  $cron$select public.run_background_ai_queue_tick();$cron$
);
