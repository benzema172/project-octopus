create or replace function public.claim_next_processing_job(
  p_worker text,
  p_workspace_id uuid default null
)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Jeden ciężki dokument AI naraz. To chroni zewnętrzne limity modeli i eliminuje
  -- wyścig dwóch workerów pobierających równolegle kolejne duże PDF-y.
  if exists (
    select 1
    from public.processing_jobs active
    where active.status = 'running'
      and coalesce(active.last_heartbeat_at, active.locked_at, active.updated_at) >= now() - interval '6 minutes'
  ) then
    return;
  end if;

  return query
  with candidate as (
    select pj.id
    from public.processing_jobs pj
    where pj.status = 'queued'
      and (p_workspace_id is null or pj.workspace_id = p_workspace_id)
      and pj.available_at <= now()
      and pj.attempt_count < pj.max_attempts
      and pj.document_version_id is not null
      and not exists (
        select 1
        from public.document_classifications dc
        where dc.document_version_id = pj.document_version_id
          and dc.status = 'approved'
      )
    order by pj.priority asc, pj.created_at asc
    for update skip locked
    limit 1
  )
  update public.processing_jobs pj
  set status = 'running',
      locked_at = now(),
      locked_by = p_worker,
      last_heartbeat_at = now(),
      started_at = coalesce(pj.started_at, now()),
      attempt_count = pj.attempt_count + 1,
      updated_at = now()
  from candidate c
  where pj.id = c.id
  returning pj.*;
end;
$$;

revoke all on function public.claim_next_processing_job(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_processing_job(text, uuid) to service_role;

create or replace function public.recover_stale_processing_jobs(
  p_stale_after interval default interval '6 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  -- Zatwierdzona wersja jest niezmienna. Jeżeli starszy worker pozostawił jej job
  -- w stanie queued/running/failed/dead_letter, domykamy job zamiast ponownie
  -- uruchamiać analizę, która z definicji zostałaby odrzucona.
  update public.processing_jobs pj
  set status = 'succeeded',
      stage = 'complete',
      available_at = now(),
      locked_at = null,
      locked_by = null,
      last_heartbeat_at = now(),
      finished_at = coalesce(pj.finished_at, now()),
      dead_letter_at = null,
      error_code = null,
      error_message = null,
      updated_at = now()
  where pj.status in ('queued', 'running', 'failed', 'dead_letter')
    and pj.document_version_id is not null
    and exists (
      select 1
      from public.document_classifications dc
      where dc.document_version_id = pj.document_version_id
        and dc.status = 'approved'
    );

  update public.documents d
  set ai_status = 'ready',
      updated_at = now()
  where exists (
    select 1
    from public.document_versions dv
    join public.document_classifications dc
      on dc.document_version_id = dv.id
     and dc.status = 'approved'
    where dv.document_id = d.id
  )
    and d.ai_status in ('queued', 'processing', 'error');

  update public.document_intakes di
  set status = 'ready'
  where di.status in ('queued', 'processing', 'error')
    and exists (
      select 1
      from public.document_versions dv
      join public.document_classifications dc
        on dc.document_version_id = dv.id
       and dc.status = 'approved'
      where dv.document_id = di.document_id
    );

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
      and not exists (
        select 1
        from public.document_classifications dc
        where dc.document_version_id = pj.document_version_id
          and dc.status = 'approved'
      )
    returning pj.document_version_id
  )
  select count(*) into v_count from recovered;

  if v_count > 0 then
    update public.documents d
    set ai_status = 'queued',
        updated_at = now()
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
      and pj.document_version_id is not null
      and not exists (
        select 1
        from public.document_classifications dc
        where dc.document_version_id = pj.document_version_id
          and dc.status = 'approved'
      )
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
