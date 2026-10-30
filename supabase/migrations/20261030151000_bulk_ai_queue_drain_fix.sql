-- Resume large Wrzutnia batches promptly: the 5-minute/one-document cadence
-- stranded 81 uploaded documents in queued state. Keep idle cron sleeping.
-- The global running lock and Gemini cooldown remain authoritative.
create or replace function public.run_background_ai_queue_tick()
returns bigint language plpgsql security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_token text;
  v_request_id bigint;
begin
  -- Preserve the existing stale-recovery and no-overlap semantics.
  perform public.recover_stale_processing_jobs(interval '6 minutes');
  if exists (
    select 1 from public.processing_jobs pj
    where pj.status='running'
      and coalesce(pj.last_heartbeat_at,pj.locked_at,pj.updated_at) >= now()-interval '6 minutes'
  ) then return null; end if;
  if not exists (
    select 1 from public.processing_jobs pj
    where pj.status='queued'
      and pj.available_at<=now()
      and pj.attempt_count<pj.max_attempts
      and pj.document_version_id is not null
      and not exists (
        select 1 from public.document_classifications dc
        where dc.document_version_id=pj.document_version_id and dc.status='approved'
      )
  ) then return null; end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name='octopus_background_worker_token'
  limit 1;
  if v_token is null or length(v_token)<32 then return null; end if;

  -- At most three documents per invocation. The worker still enforces
  -- its own 225s cutoff; pg_cron never forces parallel Gemini calls.
  select net.http_post(
    url:='https://project-octopus-alpha.vercel.app/api/brain/worker?limit=3',
    body:='{}'::jsonb,
    params:='{}'::jsonb,
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'X-Octopus-Background-Token',v_token
    ),
    timeout_milliseconds:=240000
  ) into v_request_id;
  return v_request_id;
end;
$function$;

-- Retain existing role grants for the function; lock the public API down.
revoke all on function public.run_background_ai_queue_tick() from public,anon,authenticated;
grant execute on function public.run_background_ai_queue_tick() to service_role;

-- Only run the 1-minute safety tick while the queue actually contains work.
-- Existing wake/sleep triggers still toggle active based on queued/running rows.
do $schedule$
declare v_job_id bigint;
begin
  if to_regnamespace('cron') is null then return; end if;
  select jobid into v_job_id from cron.job
  where jobname='octopus-background-ai-queue-132' limit 1;
  if v_job_id is null then
    raise notice 'Project Octopus: background AI scheduler absent; manual route remains available.';
    return;
  end if;
  perform cron.alter_job(
    v_job_id,
    schedule:='* * * * *',
    active:=exists(
      select 1 from public.processing_jobs j
      where j.status in ('queued','running')
        and j.document_version_id is not null
        and j.attempt_count<j.max_attempts
    )
  );
end;
$schedule$;
