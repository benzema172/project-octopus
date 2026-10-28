-- Prevent an idle cron tick from disabling a queue activated concurrently.
-- Acquire the same advisory transaction lock as each enqueue event before
-- deciding whether the cron worker can safely go to sleep.

create or replace function private.octopus_document_active_queue_tick_20261028()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_id bigint;
  v_job_id bigint;
begin
  v_request_id := public.run_background_ai_queue_tick();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('octopus-document-queue-scheduler-v1', 0)
  );
  if not exists(
    select 1 from public.processing_jobs pj
    where pj.status in ('queued','running')
      and pj.document_version_id is not null
      and pj.attempt_count < pj.max_attempts
  ) then
    select jobid into v_job_id from cron.job
    where jobname = 'octopus-background-ai-queue-132';
    if v_job_id is not null then
      perform cron.alter_job(v_job_id, active := false);
    end if;
  end if;
  return v_request_id;
end;
$function$;

create or replace function private.octopus_finance_active_queue_tick_20261028()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_id bigint;
  v_job_id bigint;
begin
  v_request_id := public.run_unified_document_ai_queue_tick();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('octopus-finance-queue-scheduler-v1', 0)
  );
  if not exists(
    select 1 from public.get_pending_finance_multi_ai_reviews(1, false)
  ) then
    select jobid into v_job_id from cron.job
    where jobname = 'octopus-finance-ai-copilot-200';
    if v_job_id is not null then
      perform cron.alter_job(v_job_id, active := false);
    end if;
  end if;
  return v_request_id;
end;
$function$;

revoke all on function private.octopus_document_active_queue_tick_20261028()
  from public, anon, authenticated;
revoke all on function private.octopus_finance_active_queue_tick_20261028()
  from public, anon, authenticated;
