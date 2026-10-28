-- Project Octopus: activate background AI only when it has work.
-- Existing upload flow calls /api/brain/process immediately after upload.
-- These cron workers are retained only as retries/overflow while a queue has work.
-- No 30-minute idle fallback is introduced.
-- Technical pg_cron execution logs are retained for 14 days; audit data is untouched.

create or replace function private.octopus_document_queue_wakeup_20261028()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_id bigint;
  v_active boolean;
  v_has_work boolean;
begin
  -- Serialize concurrent activations/deactivations before reading job state.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('octopus-document-queue-scheduler-v1', 0)
  );

  select j.jobid, j.active into v_job_id, v_active
  from cron.job j
  where j.jobname = 'octopus-background-ai-queue-132';

  if v_job_id is null then
    raise warning 'Octopus document queue cron job not found';
    return new;
  end if;

  select exists(
    select 1 from public.processing_jobs pj
    where pj.status in ('queued', 'running')
      and pj.document_version_id is not null
      and pj.attempt_count < pj.max_attempts
  ) into v_has_work;

  if v_has_work and not v_active then
    perform cron.alter_job(v_job_id, active := true);
  elsif not v_has_work and v_active then
    perform cron.alter_job(v_job_id, active := false);
  end if;
  return new;
exception when others then
  -- The upload or AI result must not be lost due to a scheduler failure.
  raise warning 'Octopus document scheduler could not be updated: %', sqlerrm;
  return new;
end;
$function$;

create or replace function private.octopus_finance_queue_wakeup_20261028()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_id bigint;
  v_active boolean;
  v_has_work boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('octopus-finance-queue-scheduler-v1', 0)
  );

  select j.jobid, j.active into v_job_id, v_active
  from cron.job j
  where j.jobname = 'octopus-finance-ai-copilot-200';

  if v_job_id is null then
    raise warning 'Octopus finance AI cron job not found';
    return new;
  end if;
  select exists(
    select 1 from public.get_pending_finance_multi_ai_reviews(1, false)
  ) into v_has_work;

  if v_has_work and not v_active then
    perform cron.alter_job(v_job_id, active := true);
  elsif not v_has_work and v_active then
    perform cron.alter_job(v_job_id, active := false);
  end if;
  return new;
exception when others then
  raise warning 'Octopus finance AI scheduler could not be updated: %', sqlerrm;
  return new;
end;
$function$;

-- When a new document is added, a queue row activates the background worker.
-- When the last row completes, the cron worker sleeps until new work arrives.
drop trigger if exists octopus_document_queue_wakeup_20261028 on public.processing_jobs;
create trigger octopus_document_queue_wakeup_20261028
after insert or update of status, available_at, attempt_count
on public.processing_jobs
for each row execute function private.octopus_document_queue_wakeup_20261028();

-- Finance reviews can arrive during invoice routing; activate only for open
-- reviews without an existing AI consensus, and sleep after a decision.
drop trigger if exists octopus_finance_review_wakeup_20261028 on public.finance_document_reviews;
create trigger octopus_finance_review_wakeup_20261028
after insert or update of status
on public.finance_document_reviews
for each row execute function private.octopus_finance_queue_wakeup_20261028();

drop trigger if exists octopus_finance_consensus_wakeup_20261028 on public.ai_consensus_events;
create trigger octopus_finance_consensus_wakeup_20261028
after insert on public.ai_consensus_events
for each row execute function private.octopus_finance_queue_wakeup_20261028();

-- The original cron jobs keep their cadence only while there is actual
-- work. The wrapper stops its own timer once the queue is empty.
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

-- No direct API access to privileged scheduler functions.
revoke all on function private.octopus_document_queue_wakeup_20261028() from public, anon, authenticated;
revoke all on function private.octopus_finance_queue_wakeup_20261028() from public, anon, authenticated;
revoke all on function private.octopus_document_active_queue_tick_20261028() from public, anon, authenticated;
revoke all on function private.octopus_finance_active_queue_tick_20261028() from public, anon, authenticated;

do $do$
declare
  v_documents bigint;
  v_finance bigint;
begin
  select jobid into v_documents from cron.job where jobname='octopus-background-ai-queue-132';
  select jobid into v_finance from cron.job where jobname='octopus-finance-ai-copilot-200';
  if v_documents is null or v_finance is null then
    raise exception 'Expected Octopus AI cron jobs are missing: documents %, finance %', v_documents, v_finance;
  end if;

  perform cron.alter_job(
    v_documents,
    command := 'select private.octopus_document_active_queue_tick_20261028();',
    active := exists (
      select 1 from public.processing_jobs pj
      where pj.status in ('queued','running')
        and pj.document_version_id is not null
        and pj.attempt_count < pj.max_attempts
    )
  );

  perform cron.alter_job(
    v_finance,
    command := 'select private.octopus_finance_active_queue_tick_20261028();',
    active := exists (
      select 1 from public.get_pending_finance_multi_ai_reviews(1, false)
    )
  );
end;
$do$;

-- Retain *only* technical pg_cron execution history for the last 14 days.
-- This does not affect documents, accounting data, audit logs or AI results.
select cron.schedule(
  'octopus-technical-cron-history-retention-14d',
  '15 3 * * *',
  $cron$delete from cron.job_run_details where start_time < now() - interval '14 days';$cron$
);

delete from cron.job_run_details
where start_time < now() - interval '14 days';
