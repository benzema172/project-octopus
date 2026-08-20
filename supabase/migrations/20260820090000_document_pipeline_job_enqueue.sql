begin;

-- Every successfully persisted R2 version must have a durable pipeline job.
-- The AI worker updates this row throughout extraction/analyze/persist stages;
-- without it failures were invisible and successful runs could not satisfy the
-- operational audit contract.
create or replace function public.enqueue_document_pipeline_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_project_id uuid;
begin
  if coalesce(new.upload_status, '') <> 'uploaded'
     or new.r2_object_key is null
     or new.document_id is null then
    return new;
  end if;

  select d.workspace_id, d.project_id
    into v_workspace_id, v_project_id
  from public.documents d
  where d.id = new.document_id;

  if v_workspace_id is null then
    return new;
  end if;

  insert into public.processing_jobs(
    workspace_id,
    project_id,
    document_id,
    document_version_id,
    job_type,
    job_key,
    stage,
    status,
    priority,
    attempt_count,
    available_at
  ) values (
    v_workspace_id,
    coalesce(new.project_id, v_project_id),
    new.document_id,
    new.id,
    'document_pipeline',
    'document-pipeline:' || new.id::text,
    'extract',
    'queued',
    100,
    0,
    now()
  )
  on conflict (job_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_document_pipeline_job() from public, anon, authenticated;

-- Recreate to make the migration idempotent across clean and upgraded databases.
drop trigger if exists document_versions_enqueue_pipeline_job on public.document_versions;
create trigger document_versions_enqueue_pipeline_job
after insert or update of upload_status, r2_object_key
on public.document_versions
for each row
when (new.upload_status = 'uploaded' and new.r2_object_key is not null)
execute function public.enqueue_document_pipeline_job();

insert into public.app_schema_versions(version)
values ('20260820_document_pipeline_job_enqueue')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
