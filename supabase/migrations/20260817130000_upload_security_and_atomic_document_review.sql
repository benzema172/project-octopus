-- Project Octopus 0.7.2: verified upload content, queue health and atomic document review.

alter table public.document_versions add column if not exists security_status text not null default 'pending';
alter table public.document_versions add column if not exists security_report jsonb not null default '{}'::jsonb;
alter table public.document_versions add column if not exists security_scanned_at timestamptz;

create or replace function public.mark_server_generated_document_security()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.r2_object_key like 'generated/%' and new.mime_type in ('text/html', 'application/pdf') then
    update public.document_versions
    set security_status = 'passed',
        security_report = jsonb_build_object(
          'status', 'passed', 'source', 'server-generated', 'sha256', new.sha256,
          'checks', jsonb_build_array('server-rendered', 'escaped-output')
        ),
        security_scanned_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists generated_document_security on public.document_versions;
create trigger generated_document_security
after insert on public.document_versions
for each row execute function public.mark_server_generated_document_security();

create index if not exists processing_jobs_workspace_health_idx
on public.processing_jobs (workspace_id, status, updated_at desc);

create or replace function public.complete_document_upload_secure(
  p_document_id uuid,
  p_version_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_file_name text,
  p_category text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_r2_bucket text,
  p_r2_object_key text,
  p_r2_etag text,
  p_sha256 text,
  p_security_report jsonb,
  p_uploaded_by uuid,
  p_uploaded_at timestamptz
)
returns table(document_id uuid, version_id uuid, version_number integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result record;
begin
  if coalesce(p_security_report->>'status', '') <> 'passed' then
    raise exception 'Upload security report did not pass' using errcode = '22023';
  end if;
  if coalesce(p_security_report->>'sha256', '') <> coalesce(p_sha256, '') then
    raise exception 'Upload security checksum mismatch' using errcode = '22023';
  end if;

  select * into v_result
  from public.complete_document_upload(
    p_document_id, p_version_id, p_workspace_id, p_project_id, p_file_name,
    p_category, p_mime_type, p_file_size_bytes, p_r2_bucket, p_r2_object_key,
    p_r2_etag, p_sha256, p_uploaded_by, p_uploaded_at
  );

  update public.document_versions version
  set security_status = 'passed', security_report = p_security_report, security_scanned_at = now()
  where version.id = p_version_id and version.document_id = p_document_id;

  return query select v_result.document_id, v_result.version_id, v_result.version_number;
end;
$$;

revoke all on function public.complete_document_upload_secure(
  uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, jsonb, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_document_upload_secure(
  uuid, uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, jsonb, uuid, timestamptz
) to service_role;

create or replace function public.recover_stale_processing_jobs(p_workspace_id uuid default null)
returns table(result_requeued integer, result_dead_lettered integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requeued integer := 0;
  v_dead_lettered integer := 0;
begin
  update public.processing_jobs job
  set status = 'queued', stage = 'extract', available_at = now(), locked_at = null,
      locked_by = null, error_code = 'STALE_RECOVERED',
      error_message = 'Worker heartbeat expired; job returned to queue.', updated_at = now()
  where job.status = 'running'
    and (p_workspace_id is null or job.workspace_id = p_workspace_id)
    and coalesce(job.last_heartbeat_at, job.locked_at, job.started_at, job.updated_at) < now() - interval '15 minutes'
    and job.attempt_count < job.max_attempts;
  get diagnostics v_requeued = row_count;

  update public.processing_jobs job
  set status = 'dead_letter', dead_letter_at = now(), locked_at = null, locked_by = null,
      error_code = 'STALE_MAX_ATTEMPTS',
      error_message = 'Worker heartbeat expired after the final attempt.', updated_at = now()
  where job.status = 'running'
    and (p_workspace_id is null or job.workspace_id = p_workspace_id)
    and coalesce(job.last_heartbeat_at, job.locked_at, job.started_at, job.updated_at) < now() - interval '15 minutes'
    and job.attempt_count >= job.max_attempts;
  get diagnostics v_dead_lettered = row_count;

  return query select v_requeued, v_dead_lettered;
end;
$$;

revoke all on function public.recover_stale_processing_jobs(uuid) from public, anon, authenticated;
grant execute on function public.recover_stale_processing_jobs(uuid) to service_role;

create or replace function public.review_document_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_approved boolean,
  p_decided_by uuid,
  p_note text default null
)
returns table(result_project_id uuid, result_status text, result_materials integer, result_devices integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.documents%rowtype;
  v_classification public.document_classifications%rowtype;
  v_project_id uuid;
  v_category text;
  v_status text := case when p_approved then 'approved' else 'rejected' end;
  v_previous_status text;
  v_extraction jsonb := '{}'::jsonb;
  v_material_count integer := 0;
  v_device_count integer := 0;
begin
  select document.* into v_document
  from public.documents document
  where document.id = p_document_id and document.workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Document not found in workspace' using errcode = 'P0002'; end if;
  if v_document.current_version_id is null then raise exception 'Document has no current version' using errcode = '22023'; end if;

  v_previous_status := v_document.review_status;
  select classification.* into v_classification
  from public.document_classifications classification
  where classification.document_id = p_document_id
    and classification.document_version_id = v_document.current_version_id
  order by classification.created_at desc
  limit 1
  for update;

  v_project_id := case when p_approved then coalesce(v_classification.proposed_project_id, v_document.project_id) else v_document.project_id end;
  v_category := case when p_approved then coalesce(v_classification.category, v_document.category, 'other') else v_document.category end;
  if v_project_id is not null and not exists (
    select 1 from public.projects project where project.id = v_project_id and project.workspace_id = p_workspace_id
  ) then raise exception 'Classified project does not belong to workspace' using errcode = '42501'; end if;

  if v_classification.id is not null then
    update public.document_classifications
    set status = v_status, approved_by = p_decided_by, approved_at = now()
    where id = v_classification.id;
  end if;

  update public.document_extractions
  set status = v_status, project_id = case when p_approved then v_project_id else project_id end
  where document_id = p_document_id
    and document_version_id = v_document.current_version_id
    and status = 'proposed';

  update public.document_intakes
  set status = case when p_approved then 'ready' else 'rejected' end,
      proposed_project_id = case when p_approved then v_project_id else proposed_project_id end,
      suggested_category = case when p_approved then v_category else suggested_category end,
      decided_by = p_decided_by, decided_at = now(), decision_note = p_note
  where document_id = p_document_id;

  update public.documents
  set category = v_category,
      project_id = case when p_approved then v_project_id else project_id end,
      review_status = v_status,
      ai_status = case when p_approved then 'ready' else 'rejected' end,
      approved_by = case when p_approved then p_decided_by else null end,
      approved_at = case when p_approved then now() else null end,
      updated_at = now()
  where id = p_document_id;

  if p_approved and v_project_id is not null then
    update public.document_versions set project_id = v_project_id where id = v_document.current_version_id;

    update public.project_facts fact set status = 'superseded'
    from public.source_references source
    where fact.source_reference_id = source.id and source.document_id = p_document_id
      and source.document_version_id is distinct from v_document.current_version_id and fact.status = 'approved';
    update public.project_facts fact set status = 'approved', approved_by = p_decided_by, approved_at = now()
    from public.source_references source
    where fact.source_reference_id = source.id and source.document_id = p_document_id
      and source.document_version_id = v_document.current_version_id and fact.status = 'proposed';

    update public.project_requirements set status = 'superseded'
    where source_document_id = p_document_id and status = 'approved'
      and nullif(source_locator->>'document_version_id', '') is distinct from v_document.current_version_id::text;
    update public.project_requirements set status = 'approved'
    where source_document_id = p_document_id and status = 'proposed'
      and source_locator->>'document_version_id' = v_document.current_version_id::text;

    update public.protocol_requirements requirement set status = 'superseded'
    from public.source_references source
    where requirement.source_reference_id = source.id and source.document_id = p_document_id
      and source.document_version_id is distinct from v_document.current_version_id and requirement.status = 'required';
    update public.protocol_requirements requirement set status = 'required'
    from public.source_references source
    where requirement.source_reference_id = source.id and source.document_id = p_document_id
      and source.document_version_id = v_document.current_version_id and requirement.status = 'proposed';

    update public.evidence_requirements evidence set status = 'superseded'
    from public.source_references source
    where evidence.source_reference_id = source.id and source.document_id = p_document_id
      and source.document_version_id is distinct from v_document.current_version_id and evidence.status in ('missing', 'accepted');
    update public.evidence_requirements evidence set status = 'missing'
    from public.source_references source
    where evidence.source_reference_id = source.id and source.document_id = p_document_id
      and source.document_version_id = v_document.current_version_id and evidence.status = 'proposed';

    if v_previous_status <> 'approved' then
      delete from public.materials material using public.source_references source
      where material.source_reference_id = source.id and source.document_id = p_document_id;
      delete from public.devices device using public.source_references source
      where device.source_reference_id = source.id and source.document_id = p_document_id;

      select extraction.payload into v_extraction
      from public.document_extractions extraction
      where extraction.document_id = p_document_id
        and extraction.document_version_id = v_document.current_version_id
        and extraction.extraction_type = 'document_context'
      order by extraction.created_at desc limit 1;
      v_extraction := coalesce(v_extraction, '{}'::jsonb);

      insert into public.materials (project_id, name, installation, specification, source_reference_id)
      select v_project_id, trim(material.item->>'name'), nullif(trim(material.item->>'installation'), ''),
        nullif(trim(material.item->>'specification'), ''),
        nullif(v_extraction #>> array['sourceReferenceMap', 'materials', (material.ordinality - 1)::text], '')::uuid
      from jsonb_array_elements(coalesce(v_extraction->'materials', '[]'::jsonb)) with ordinality as material(item, ordinality)
      where nullif(trim(material.item->>'name'), '') is not null;
      get diagnostics v_material_count = row_count;

      insert into public.devices (project_id, name, installation, parameters, source_reference_id)
      select v_project_id, trim(device.item->>'name'), nullif(trim(device.item->>'installation'), ''),
        jsonb_build_object('items', case when jsonb_typeof(device.item->'parameters') = 'array' then device.item->'parameters' else '[]'::jsonb end),
        nullif(v_extraction #>> array['sourceReferenceMap', 'devices', (device.ordinality - 1)::text], '')::uuid
      from jsonb_array_elements(coalesce(v_extraction->'devices', '[]'::jsonb)) with ordinality as device(item, ordinality)
      where nullif(trim(device.item->>'name'), '') is not null;
      get diagnostics v_device_count = row_count;
    else
      select count(*)::integer into v_material_count from public.materials material join public.source_references source on source.id = material.source_reference_id where source.document_id = p_document_id;
      select count(*)::integer into v_device_count from public.devices device join public.source_references source on source.id = device.source_reference_id where source.document_id = p_document_id;
    end if;
  else
    update public.project_facts fact set status = 'rejected', approved_by = null, approved_at = null
    from public.source_references source
    where fact.source_reference_id = source.id and source.document_id = p_document_id and fact.status in ('proposed', 'approved');
    update public.project_requirements set status = 'rejected' where source_document_id = p_document_id and status in ('proposed', 'approved');
    update public.protocol_requirements requirement set status = 'rejected'
    from public.source_references source where requirement.source_reference_id = source.id and source.document_id = p_document_id and requirement.status in ('proposed', 'required');
    update public.evidence_requirements evidence set status = 'rejected'
    from public.source_references source where evidence.source_reference_id = source.id and source.document_id = p_document_id and evidence.status in ('proposed', 'missing', 'accepted');
    update public.estimate_imports set status = 'rejected', approved_by = p_decided_by, approved_at = now()
    where document_id = p_document_id and status in ('mapping', 'review', 'error');
    delete from public.materials material using public.source_references source
    where material.source_reference_id = source.id and source.document_id = p_document_id;
    delete from public.devices device using public.source_references source
    where device.source_reference_id = source.id and source.document_id = p_document_id;
  end if;

  insert into public.ai_review_actions (
    workspace_id, project_id, document_id, entity_type, entity_id, action,
    previous_status, next_status, note, decided_by
  ) values (
    p_workspace_id, v_project_id, p_document_id, 'document', p_document_id::text,
    case when p_approved then 'approve' else 'reject' end,
    v_previous_status, v_status, p_note, p_decided_by
  );
  insert into public.audit_events (
    workspace_id, project_id, actor_id, event_type, entity_type, entity_id, before_value, after_value
  ) values (
    p_workspace_id, v_project_id, p_decided_by,
    case when p_approved then 'document.approve' else 'document.reject' end,
    'document', p_document_id::text,
    jsonb_build_object('review_status', v_previous_status),
    jsonb_build_object('review_status', v_status, 'category', v_category, 'project_id', v_project_id, 'note', p_note)
  );

  return query select v_project_id, v_status, v_material_count, v_device_count;
end;
$$;

revoke all on function public.review_document_atomic(uuid, uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.review_document_atomic(uuid, uuid, boolean, uuid, text) to service_role;

insert into public.app_schema_versions (version)
values ('20260817_upload_security_and_atomic_document_review')
on conflict (version) do nothing;
