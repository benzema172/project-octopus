begin;

-- Triage and its audit trail must succeed or fail together. The RPC also
-- prevents an ordinary writer from racing another reviewer and stealing an
-- already claimed decision.
create or replace function public.triage_document_intake_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_actor_id uuid,
  p_action text,
  p_priority text default null,
  p_due_at timestamptz default null,
  p_allow_reassign boolean default false
)
returns table(assigned_to uuid, priority text, review_due_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intake public.document_intakes%rowtype;
  v_project uuid;
begin
  if p_action not in ('claim','release','priority','due_at') then
    raise exception 'Unsupported intake triage action' using errcode = '22023';
  end if;

  select di.* into v_intake
  from public.document_intakes di
  where di.workspace_id = p_workspace_id and di.document_id = p_document_id
  for update;
  if not found then raise exception 'Document intake does not belong to workspace' using errcode = '42501'; end if;
  if v_intake.status <> 'review' then raise exception 'Only a review intake can be triaged' using errcode = '22023'; end if;

  select d.project_id into v_project from public.documents d
  where d.id = p_document_id and d.workspace_id = p_workspace_id;
  if not found then raise exception 'Document does not belong to workspace' using errcode = '42501'; end if;

  if p_action = 'claim' then
    if v_intake.assigned_to is not null
       and v_intake.assigned_to <> p_actor_id
       and not coalesce(p_allow_reassign,false) then
      raise exception 'Document review is already assigned to another user' using errcode = '42501';
    end if;
    update public.document_intakes set assigned_to = p_actor_id where id = v_intake.id;
  elsif p_action = 'release' then
    if v_intake.assigned_to is distinct from p_actor_id
       and not coalesce(p_allow_reassign,false) then
      raise exception 'Only the assignee or an approver can release this review' using errcode = '42501';
    end if;
    update public.document_intakes set assigned_to = null where id = v_intake.id;
  elsif p_action = 'priority' then
    if p_priority not in ('low','normal','high','critical') then
      raise exception 'Unsupported review priority' using errcode = '22023';
    end if;
    update public.document_intakes set priority = p_priority where id = v_intake.id;
  else
    update public.document_intakes set review_due_at = p_due_at where id = v_intake.id;
  end if;

  insert into public.audit_events(
    workspace_id, project_id, actor_id, event_type, entity_type, entity_id,
    before_value, after_value
  )
  select p_workspace_id, v_project, p_actor_id, 'document.triage_' || p_action,
    'document', p_document_id::text,
    jsonb_build_object(
      'assignedTo', v_intake.assigned_to,
      'priority', v_intake.priority,
      'dueAt', v_intake.review_due_at
    ),
    jsonb_build_object(
      'assignedTo', di.assigned_to,
      'priority', di.priority,
      'dueAt', di.review_due_at
    )
  from public.document_intakes di where di.id = v_intake.id;

  return query
  select di.assigned_to, di.priority, di.review_due_at
  from public.document_intakes di where di.id = v_intake.id;
end;
$$;

revoke all on function public.triage_document_intake_atomic(uuid,uuid,uuid,text,text,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.triage_document_intake_atomic(uuid,uuid,uuid,text,text,timestamptz,boolean) to service_role;

-- One transaction owns idempotency, document creation, intake source metadata,
-- channel health and audit. An advisory lock makes simultaneous callbacks for
-- the same external key return the already-created record deterministically.
create or replace function public.complete_integrated_document_upload_v3(
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
  p_uploaded_at timestamptz,
  p_category_locked boolean,
  p_source_channel text,
  p_source_external_key text,
  p_source_metadata jsonb default '{}'::jsonb
)
returns table(document_id uuid, version_id uuid, version_number integer, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_document uuid;
  v_existing_version uuid;
  v_existing_number integer;
  v_completed record;
begin
  if nullif(trim(coalesce(p_source_channel,'')),'') is null
     or nullif(trim(coalesce(p_source_external_key,'')),'') is null then
    raise exception 'Integration channel and external key are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':' || p_source_channel || ':' || p_source_external_key, 0
  ));

  select di.document_id, dv.id, coalesce(dv.version_number,dv.version_no)
  into v_existing_document, v_existing_version, v_existing_number
  from public.document_intakes di
  join public.documents d on d.id = di.document_id
  join public.document_versions dv on dv.id = d.current_version_id
  where di.workspace_id = p_workspace_id
    and di.channel = p_source_channel
    and di.source_external_key = p_source_external_key
  limit 1;

  if v_existing_document is not null then
    return query select v_existing_document, v_existing_version, v_existing_number, true;
    return;
  end if;

  select * into v_completed
  from public.complete_document_upload_v2(
    p_document_id, p_version_id, p_workspace_id, p_project_id, p_file_name,
    p_category, p_mime_type, p_file_size_bytes, p_r2_bucket, p_r2_object_key,
    p_r2_etag, p_sha256, null, p_uploaded_at, p_category_locked
  );

  update public.document_intakes
  set channel = p_source_channel,
      source_external_key = p_source_external_key,
      source_metadata = coalesce(p_source_metadata,'{}'::jsonb)
  where workspace_id = p_workspace_id and document_id = v_completed.document_id;

  insert into public.document_ingestion_channels(
    workspace_id, channel_type, name, status, configuration, last_received_at, updated_at
  ) values (
    p_workspace_id, p_source_channel, p_source_channel, 'active',
    '{"acceptsFiles":true}'::jsonb, now(), now()
  )
  on conflict(workspace_id, channel_type, name) do update set
    status = 'active', last_received_at = excluded.last_received_at, updated_at = excluded.updated_at;

  insert into public.audit_events(
    workspace_id, project_id, actor_type, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, p_project_id, 'integration', 'document.integration_received',
    'document', v_completed.document_id::text,
    jsonb_build_object(
      'sourceChannel', p_source_channel,
      'externalKey', p_source_external_key,
      'versionId', v_completed.version_id
    )
  );

  return query select v_completed.document_id, v_completed.version_id, v_completed.version_number, false;
end;
$$;

revoke all on function public.complete_integrated_document_upload_v3(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,timestamptz,boolean,text,text,jsonb
) from public, anon, authenticated;
grant execute on function public.complete_integrated_document_upload_v3(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,timestamptz,boolean,text,text,jsonb
) to service_role;

-- Publishing and revocation are formal state transitions, therefore the state
-- change, validation and audit event are one atomic operation.
create or replace function public.update_data_room_status_atomic(
  p_workspace_id uuid,
  p_data_room_id uuid,
  p_action text,
  p_actor_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.data_rooms%rowtype;
  v_status text;
begin
  if p_action not in ('publish','revoke') then
    raise exception 'Unsupported data room transition' using errcode = '22023';
  end if;
  select * into v_room from public.data_rooms
  where id = p_data_room_id and workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Data room does not belong to workspace' using errcode = '42501'; end if;

  if p_action = 'publish' then
    if v_room.status = 'published' then return 'published'; end if;
    if v_room.status <> 'draft' then raise exception 'Only a draft data room can be published' using errcode = '22023'; end if;
    if v_room.expires_at is not null and v_room.expires_at <= now() then
      raise exception 'Expired data room cannot be published' using errcode = '22023';
    end if;
    if not exists(select 1 from public.data_room_documents where data_room_id = v_room.id) then
      raise exception 'Data room has no documents' using errcode = '22023';
    end if;
    if exists(
      select 1 from public.data_room_documents rd
      join public.document_versions dv on dv.id = rd.document_version_id
      where rd.data_room_id = v_room.id
        and (dv.malware_scan_status not in ('clean','unavailable') or nullif(dv.sha256,'') is null)
    ) then
      raise exception 'Data room contains a version without security or integrity clearance' using errcode = '22023';
    end if;
    update public.data_rooms
    set status = 'published', published_by = p_actor_id, published_at = now(), updated_at = now()
    where id = v_room.id;
    v_status := 'published';
  else
    if v_room.status = 'revoked' then return 'revoked'; end if;
    if v_room.status not in ('draft','published') then
      raise exception 'Data room cannot be revoked from its current state' using errcode = '22023';
    end if;
    update public.data_rooms
    set status = 'revoked', revoked_by = p_actor_id, revoked_at = now(), updated_at = now()
    where id = v_room.id;
    v_status := 'revoked';
  end if;

  insert into public.audit_events(
    workspace_id, project_id, actor_id, event_type, entity_type, entity_id, before_value, after_value
  ) values (
    p_workspace_id, v_room.project_id, p_actor_id, 'data_room.' || v_status,
    'data_room', v_room.id::text, jsonb_build_object('status',v_room.status), jsonb_build_object('status',v_status)
  );
  return v_status;
end;
$$;

revoke all on function public.update_data_room_status_atomic(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.update_data_room_status_atomic(uuid,uuid,text,uuid) to service_role;

insert into public.app_schema_versions(version)
values('20260822_document_flow_transaction_hardening')
on conflict(version) do nothing;

commit;
