begin;

-- Configurable, multi-stage approval. The existing approvals table remains a
-- compact compatibility queue; these tables carry the complete workflow state.
create table if not exists public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  workflow_key text not null,
  name text not null,
  entity_type text not null default 'document',
  category text,
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, workflow_key)
);

create table if not exists public.approval_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.approval_workflows(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  step_order integer not null,
  name text not null,
  domain text not null default 'investments',
  access_level text not null default 'approve',
  required_decisions integer not null default 1,
  due_hours integer not null default 24,
  signature_mode text not null default 'internal',
  allow_same_actor boolean not null default true,
  created_at timestamptz not null default now(),
  unique(workflow_id, step_order)
);

do $$ begin
  alter table public.approval_workflow_steps add constraint approval_workflow_steps_signature_check
    check (signature_mode in ('none','internal','provider'));
exception when duplicate_object then null; end $$;

create table if not exists public.approval_instances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  workflow_id uuid not null references public.approval_workflows(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  document_version_id uuid references public.document_versions(id) on delete set null,
  status text not null default 'pending',
  current_step_order integer not null default 1,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists approval_instances_active_entity_uidx
  on public.approval_instances(workspace_id, entity_type, entity_id)
  where status in ('pending','in_progress');
create index if not exists approval_instances_project_queue_idx
  on public.approval_instances(workspace_id, project_id, status, due_at);

create table if not exists public.approval_step_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  approval_instance_id uuid not null references public.approval_instances(id) on delete cascade,
  workflow_step_id uuid not null references public.approval_workflow_steps(id) on delete restrict,
  decision text not null,
  note text,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now(),
  source_ip_hash text,
  user_agent text,
  evidence jsonb not null default '{}'::jsonb,
  unique(approval_instance_id, workflow_step_id, decided_by)
);

create table if not exists public.document_signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete restrict,
  approval_instance_id uuid references public.approval_instances(id) on delete set null,
  workflow_step_id uuid references public.approval_workflow_steps(id) on delete set null,
  signer_id uuid references auth.users(id) on delete set null,
  signature_method text not null default 'internal',
  content_sha256 text not null,
  provider text,
  provider_signature_id text,
  certificate_metadata jsonb not null default '{}'::jsonb,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(approval_instance_id, workflow_step_id, signer_id)
);

-- Governance and handover data rooms.
create table if not exists public.document_retention_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  policy_key text not null,
  name text not null,
  category text,
  retention_months integer not null,
  start_event text not null default 'approval',
  legal_basis text,
  status text not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, policy_key)
);

alter table public.documents
  add column if not exists retention_policy_id uuid references public.document_retention_policies(id) on delete set null;

create table if not exists public.data_rooms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  purpose text,
  status text not null default 'draft',
  recipient_name text,
  recipient_email text,
  expires_at timestamptz,
  access_token_hash text,
  created_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_room_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  data_room_id uuid not null references public.data_rooms(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  document_version_id uuid not null references public.document_versions(id) on delete restrict,
  display_name text not null,
  category text,
  sort_order integer not null default 0,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  unique(data_room_id, document_id)
);

create table if not exists public.data_room_access_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  data_room_id uuid not null references public.data_rooms(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user',
  action text not null,
  recipient_label text,
  ip_hash text,
  user_agent text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists data_rooms_project_idx
  on public.data_rooms(workspace_id, project_id, status, created_at desc);
create index if not exists data_room_documents_room_idx
  on public.data_room_documents(data_room_id, sort_order, display_name);
create index if not exists data_room_access_logs_room_idx
  on public.data_room_access_logs(data_room_id, occurred_at desc);

create or replace function public.seed_document_governance_defaults(p_workspace_id uuid, p_actor_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow uuid;
  v_count integer := 0;
begin
  insert into public.approval_workflows(
    workspace_id, workflow_key, name, entity_type, description, created_by
  ) values (
    p_workspace_id, 'document.standard.two_stage', 'Dokument · weryfikacja i zatwierdzenie',
    'document', 'Dwa proste etapy z podpisem wewnętrznym i pełnym audytem.', p_actor_id
  )
  on conflict(workspace_id, workflow_key) do update set active = true, updated_at = now()
  returning id into v_workflow;

  insert into public.approval_workflow_steps(
    workflow_id, workspace_id, step_order, name, domain, access_level,
    required_decisions, due_hours, signature_mode, allow_same_actor
  ) values
    (v_workflow,p_workspace_id,1,'Weryfikacja merytoryczna','investments','approve',1,24,'internal',true),
    (v_workflow,p_workspace_id,2,'Zatwierdzenie końcowe','investments','approve',1,24,'internal',true)
  on conflict(workflow_id, step_order) do update set
    name = excluded.name, domain = excluded.domain, access_level = excluded.access_level,
    required_decisions = excluded.required_decisions, due_hours = excluded.due_hours,
    signature_mode = excluded.signature_mode;

  insert into public.document_retention_policies(
    workspace_id, policy_key, name, category, retention_months, start_event, legal_basis, status, created_by
  ) values
    (p_workspace_id,'contract.120m','Kontrakty · 10 lat','contract',120,'approval','Polityka organizacyjna — potwierdź podstawę prawną dla firmy.','draft',p_actor_id),
    (p_workspace_id,'technical.120m','Dokumentacja techniczna · 10 lat','technical',120,'approval','Polityka organizacyjna — potwierdź wymagania kontraktu.','draft',p_actor_id),
    (p_workspace_id,'protocol.120m','Protokoły i odbiory · 10 lat','protocol',120,'approval','Polityka organizacyjna — potwierdź wymagania kontraktu.','draft',p_actor_id),
    (p_workspace_id,'invoice.60m','Dokumenty finansowe · 5 lat','invoice',60,'approval','Wartość startowa do zatwierdzenia przez księgowość.','draft',p_actor_id),
    (p_workspace_id,'default.36m','Pozostałe dokumenty · 3 lata',null,36,'approval','Wartość startowa do zatwierdzenia przez administratora.','draft',p_actor_id)
  on conflict(workspace_id, policy_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count + 1;
end;
$$;

revoke all on function public.seed_document_governance_defaults(uuid,uuid) from public, anon, authenticated;
grant execute on function public.seed_document_governance_defaults(uuid,uuid) to service_role;

create or replace function public.start_document_approval_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_workflow_id uuid,
  p_actor_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.documents%rowtype;
  v_workflow public.approval_workflows%rowtype;
  v_version uuid;
  v_instance uuid;
  v_due timestamptz;
begin
  perform public.seed_document_governance_defaults(p_workspace_id, p_actor_id);
  select * into v_document from public.documents
  where id = p_document_id and workspace_id = p_workspace_id and deleted_at is null
  for update;
  if not found then raise exception 'Document does not belong to workspace' using errcode = '42501'; end if;

  select * into v_workflow from public.approval_workflows
  where id = p_workflow_id and workspace_id = p_workspace_id and active and entity_type = 'document';
  if not found then raise exception 'Approval workflow is not active for this workspace' using errcode = '42501'; end if;

  v_version := v_document.current_version_id;
  if v_version is null then raise exception 'Document has no current version' using errcode = '22023'; end if;
  select now() + make_interval(hours => due_hours) into v_due
  from public.approval_workflow_steps where workflow_id = v_workflow.id order by step_order limit 1;

  select id into v_instance from public.approval_instances
  where workspace_id = p_workspace_id and entity_type = 'document' and entity_id = p_document_id
    and status in ('pending','in_progress')
  limit 1;
  if v_instance is not null then return v_instance; end if;

  insert into public.approval_instances(
    workspace_id, project_id, workflow_id, entity_type, entity_id,
    document_version_id, status, current_step_order, requested_by, due_at, metadata
  ) values (
    p_workspace_id, v_document.project_id, v_workflow.id, 'document', p_document_id,
    v_version, 'pending', 1, p_actor_id, v_due,
    jsonb_build_object('requestNote', nullif(trim(coalesce(p_note,'')),''))
  ) returning id into v_instance;

  insert into public.approvals(
    workspace_id, project_id, entity_type, entity_id, approval_type,
    status, requested_by, due_at, decision_note
  ) values (
    p_workspace_id, v_document.project_id, 'document', p_document_id,
    v_workflow.workflow_key, 'pending', p_actor_id, v_due, nullif(trim(coalesce(p_note,'')),'')
  );

  insert into public.audit_events(
    workspace_id, project_id, actor_id, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, v_document.project_id, p_actor_id, 'approval.started',
    'approval_instance', v_instance::text,
    jsonb_build_object('documentId', p_document_id, 'workflowId', v_workflow.id, 'documentVersionId', v_version)
  );
  return v_instance;
end;
$$;

revoke all on function public.start_document_approval_atomic(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.start_document_approval_atomic(uuid,uuid,uuid,uuid,text) to service_role;

create or replace function public.decide_document_approval_step_atomic(
  p_workspace_id uuid,
  p_instance_id uuid,
  p_action text,
  p_actor_id uuid,
  p_note text default null,
  p_signature_method text default 'internal',
  p_signature_evidence jsonb default '{}'::jsonb
)
returns table(result_instance_id uuid, result_status text, result_step_order integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instance public.approval_instances%rowtype;
  v_step public.approval_workflow_steps%rowtype;
  v_next public.approval_workflow_steps%rowtype;
  v_document public.documents%rowtype;
  v_sha text;
  v_decisions integer;
  v_status text;
  v_next_order integer;
begin
  if p_action not in ('approve','reject') then
    raise exception 'Unsupported approval action' using errcode = '22023';
  end if;
  select * into v_instance from public.approval_instances
  where id = p_instance_id and workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Approval instance does not belong to workspace' using errcode = '42501'; end if;
  if v_instance.status not in ('pending','in_progress') then
    raise exception 'Approval instance is already closed' using errcode = '22023';
  end if;

  select * into v_step from public.approval_workflow_steps
  where workflow_id = v_instance.workflow_id and step_order = v_instance.current_step_order;
  if not found then raise exception 'Approval workflow has no current step' using errcode = '22023'; end if;

  if not v_step.allow_same_actor and exists(
    select 1 from public.approval_step_decisions d
    where d.approval_instance_id = v_instance.id and d.decided_by = p_actor_id and d.decision = 'approve'
  ) then
    raise exception 'A different reviewer is required for this step' using errcode = '42501';
  end if;

  insert into public.approval_step_decisions(
    workspace_id, approval_instance_id, workflow_step_id, decision,
    note, decided_by, evidence
  ) values (
    p_workspace_id, v_instance.id, v_step.id, p_action,
    nullif(trim(coalesce(p_note,'')),''), p_actor_id, coalesce(p_signature_evidence,'{}'::jsonb)
  );

  if p_action = 'reject' then
    v_status := 'rejected';
    v_next_order := v_instance.current_step_order;
    update public.approval_instances set status = v_status, completed_at = now(), updated_at = now()
    where id = v_instance.id;
  else
    if v_step.signature_mode <> 'none' then
      select d.* into v_document from public.documents d
      where d.id = v_instance.entity_id and d.workspace_id = p_workspace_id;
      select sha256 into v_sha from public.document_versions where id = v_instance.document_version_id;
      if nullif(v_sha,'') is null then
        raise exception 'Document version must have SHA-256 before it can be signed' using errcode = '22023';
      end if;
      if v_step.signature_mode = 'provider'
         and nullif(p_signature_evidence ->> 'externalId','') is null then
        raise exception 'External signature evidence is required for provider step' using errcode = '22023';
      end if;
      insert into public.document_signatures(
        workspace_id, project_id, document_id, document_version_id,
        approval_instance_id, workflow_step_id, signer_id, signature_method,
        content_sha256, provider, provider_signature_id, certificate_metadata
      ) values (
        p_workspace_id, v_instance.project_id, v_instance.entity_id, v_instance.document_version_id,
        v_instance.id, v_step.id, p_actor_id,
        case when v_step.signature_mode = 'provider' then coalesce(nullif(p_signature_method,''),'provider') else 'internal' end,
        v_sha, nullif(p_signature_evidence ->> 'provider',''),
        nullif(p_signature_evidence ->> 'externalId',''), coalesce(p_signature_evidence,'{}'::jsonb)
      );
    end if;

    select count(*)::integer into v_decisions
    from public.approval_step_decisions
    where approval_instance_id = v_instance.id and workflow_step_id = v_step.id and decision = 'approve';

    if v_decisions >= v_step.required_decisions then
      select * into v_next from public.approval_workflow_steps
      where workflow_id = v_instance.workflow_id and step_order > v_step.step_order
      order by step_order limit 1;
      if found then
        v_status := 'in_progress';
        v_next_order := v_next.step_order;
        update public.approval_instances
        set status = v_status, current_step_order = v_next_order,
            due_at = now() + make_interval(hours => v_next.due_hours), updated_at = now()
        where id = v_instance.id;
      else
        v_status := 'approved';
        v_next_order := v_step.step_order;
        update public.approval_instances
        set status = v_status, completed_at = now(), due_at = null, updated_at = now()
        where id = v_instance.id;
      end if;
    else
      v_status := 'in_progress';
      v_next_order := v_step.step_order;
      update public.approval_instances set status = v_status, updated_at = now() where id = v_instance.id;
    end if;
  end if;

  update public.approvals
  set status = v_status,
      decided_by = case when v_status in ('approved','rejected') then p_actor_id else decided_by end,
      decided_at = case when v_status in ('approved','rejected') then now() else decided_at end,
      decision_note = coalesce(nullif(trim(coalesce(p_note,'')),''), decision_note)
  where workspace_id = p_workspace_id and entity_type = v_instance.entity_type and entity_id = v_instance.entity_id
    and status in ('pending','in_progress');

  insert into public.audit_events(
    workspace_id, project_id, actor_id, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, v_instance.project_id, p_actor_id, 'approval.step_' || p_action,
    'approval_instance', v_instance.id::text,
    jsonb_build_object('stepId', v_step.id, 'stepOrder', v_step.step_order, 'resultStatus', v_status)
  );

  return query select v_instance.id, v_status, v_next_order;
end;
$$;

revoke all on function public.decide_document_approval_step_atomic(uuid,uuid,text,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.decide_document_approval_step_atomic(uuid,uuid,text,uuid,text,text,jsonb) to service_role;

create or replace function public.apply_document_governance_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_actor_id uuid,
  p_legal_hold boolean,
  p_retention_until date,
  p_retention_policy_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.documents
  where id = p_document_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Document does not belong to workspace' using errcode = '42501'; end if;
  if p_retention_policy_id is not null and not exists(
    select 1 from public.document_retention_policies
    where id = p_retention_policy_id and workspace_id = p_workspace_id
  ) then raise exception 'Retention policy does not belong to workspace' using errcode = '42501'; end if;

  update public.documents
  set legal_hold = coalesce(p_legal_hold,false),
      retention_until = p_retention_until,
      retention_policy_id = p_retention_policy_id,
      updated_at = now()
  where id = p_document_id;

  insert into public.audit_events(
    workspace_id, project_id, actor_id, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, v_project, p_actor_id, 'document.governance_updated', 'document', p_document_id::text,
    jsonb_build_object('legalHold',coalesce(p_legal_hold,false),'retentionUntil',p_retention_until,'retentionPolicyId',p_retention_policy_id,'note',nullif(trim(coalesce(p_note,'')),''))
  );
  return p_document_id;
end;
$$;

revoke all on function public.apply_document_governance_atomic(uuid,uuid,uuid,boolean,date,uuid,text) from public, anon, authenticated;
grant execute on function public.apply_document_governance_atomic(uuid,uuid,uuid,boolean,date,uuid,text) to service_role;

create or replace function public.create_project_data_room_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_name text,
  p_purpose text,
  p_document_ids uuid[],
  p_expires_at timestamptz,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_count integer;
begin
  if not exists(select 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id) then
    raise exception 'Project does not belong to workspace' using errcode = '42501';
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'Data room name is required' using errcode = '22023'; end if;

  insert into public.data_rooms(
    workspace_id, project_id, name, purpose, status, expires_at, created_by
  ) values (
    p_workspace_id, p_project_id, trim(p_name), nullif(trim(coalesce(p_purpose,'')),''),
    'draft', p_expires_at, p_actor_id
  ) returning id into v_room;

  insert into public.data_room_documents(
    workspace_id, data_room_id, document_id, document_version_id,
    display_name, category, sort_order, added_by
  )
  select d.workspace_id, v_room, d.id, d.current_version_id, d.name,
    public.canonical_document_category(d.category),
    row_number() over(order by public.canonical_document_category(d.category), d.name)::integer,
    p_actor_id
  from public.documents d
  where d.workspace_id = p_workspace_id and d.project_id = p_project_id
    and d.review_status = 'approved' and d.deleted_at is null and d.current_version_id is not null
    and (coalesce(cardinality(p_document_ids),0) = 0 or d.id = any(p_document_ids));
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'No approved documents were selected for data room' using errcode = '22023'; end if;

  insert into public.audit_events(
    workspace_id, project_id, actor_id, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, p_project_id, p_actor_id, 'data_room.created', 'data_room', v_room::text,
    jsonb_build_object('documents',v_count,'expiresAt',p_expires_at)
  );
  return v_room;
end;
$$;

revoke all on function public.create_project_data_room_atomic(uuid,uuid,text,text,uuid[],timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.create_project_data_room_atomic(uuid,uuid,text,text,uuid[],timestamptz,uuid) to service_role;

create or replace function public.get_data_room_manifest(p_workspace_id uuid, p_data_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'purpose', r.purpose,
    'status', r.status,
    'projectId', r.project_id,
    'expiresAt', r.expires_at,
    'createdAt', r.created_at,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'documentId', rd.document_id,
        'versionId', rd.document_version_id,
        'name', rd.display_name,
        'category', rd.category,
        'version', dv.version_number,
        'sha256', dv.sha256,
        'mimeType', dv.mime_type,
        'sizeBytes', dv.file_size_bytes
      ) order by rd.sort_order, rd.display_name)
      from public.data_room_documents rd
      join public.document_versions dv on dv.id = rd.document_version_id
      where rd.data_room_id = r.id
    ), '[]'::jsonb)
  )
  from public.data_rooms r
  where r.id = p_data_room_id and r.workspace_id = p_workspace_id;
$$;

revoke all on function public.get_data_room_manifest(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_data_room_manifest(uuid,uuid) to service_role;

create or replace function public.record_data_room_access_atomic(
  p_workspace_id uuid,
  p_data_room_id uuid,
  p_document_id uuid,
  p_actor_id uuid,
  p_action text,
  p_user_agent text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not exists(select 1 from public.data_rooms where id = p_data_room_id and workspace_id = p_workspace_id) then
    raise exception 'Data room does not belong to workspace' using errcode = '42501';
  end if;
  if p_document_id is not null and not exists(
    select 1 from public.data_room_documents where data_room_id = p_data_room_id and document_id = p_document_id
  ) then raise exception 'Document is not in data room' using errcode = '42501'; end if;

  insert into public.data_room_access_logs(
    workspace_id, data_room_id, document_id, actor_id, actor_type,
    action, user_agent, metadata
  ) values (
    p_workspace_id, p_data_room_id, p_document_id, p_actor_id,
    case when p_actor_id is null then 'recipient' else 'user' end,
    p_action, left(p_user_agent,500), coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_data_room_access_atomic(uuid,uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_data_room_access_atomic(uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.trg_apply_default_retention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.document_retention_policies%rowtype;
begin
  if new.review_status = 'approved'
     and old.review_status is distinct from new.review_status
     and new.retention_policy_id is null then
    perform public.seed_document_governance_defaults(new.workspace_id, new.approved_by);
    select * into v_policy from public.document_retention_policies p
    where p.workspace_id = new.workspace_id
      and (p.category is null or public.canonical_document_category(p.category) = public.canonical_document_category(new.category))
    order by (p.category is not null) desc, p.created_at
    limit 1;
    if found then
      new.retention_policy_id := v_policy.id;
      new.retention_until := coalesce(new.retention_until, (current_date + make_interval(months => v_policy.retention_months))::date);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_default_document_retention on public.documents;
create trigger apply_default_document_retention
before update of review_status on public.documents
for each row execute function public.trg_apply_default_retention();

create or replace function public.trg_protect_governed_document()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    if old.legal_hold then
      raise exception 'Document is protected by legal hold' using errcode = '42501';
    end if;
    if old.retention_until is not null and old.retention_until > current_date then
      raise exception 'Document is protected by retention policy until %', old.retention_until using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_governed_document on public.documents;
create trigger protect_governed_document
before update of deleted_at on public.documents
for each row execute function public.trg_protect_governed_document();

select public.seed_document_governance_defaults(w.id, w.owner_id)
from public.workspaces w;

alter table public.approval_workflows enable row level security;
alter table public.approval_workflow_steps enable row level security;
alter table public.approval_instances enable row level security;
alter table public.approval_step_decisions enable row level security;
alter table public.document_signatures enable row level security;
alter table public.document_retention_policies enable row level security;
alter table public.data_rooms enable row level security;
alter table public.data_room_documents enable row level security;
alter table public.data_room_access_logs enable row level security;

drop policy if exists approval_workflows_read on public.approval_workflows;
create policy approval_workflows_read on public.approval_workflows for select to authenticated
using (public.has_domain_access(workspace_id,'settings','read',null));
drop policy if exists approval_workflow_steps_read on public.approval_workflow_steps;
create policy approval_workflow_steps_read on public.approval_workflow_steps for select to authenticated
using (public.has_domain_access(workspace_id,'settings','read',null));
drop policy if exists approval_instances_read on public.approval_instances;
create policy approval_instances_read on public.approval_instances for select to authenticated
using (public.has_domain_access(workspace_id,'investments','read',project_id));
drop policy if exists approval_step_decisions_read on public.approval_step_decisions;
create policy approval_step_decisions_read on public.approval_step_decisions for select to authenticated
using (exists(select 1 from public.approval_instances i where i.id = approval_step_decisions.approval_instance_id and public.has_domain_access(i.workspace_id,'investments','read',i.project_id)));
drop policy if exists document_signatures_read on public.document_signatures;
create policy document_signatures_read on public.document_signatures for select to authenticated
using (public.has_domain_access(workspace_id,'investments','read',project_id));
drop policy if exists document_retention_policies_read on public.document_retention_policies;
create policy document_retention_policies_read on public.document_retention_policies for select to authenticated
using (public.has_domain_access(workspace_id,'settings','read',null));
drop policy if exists data_rooms_read on public.data_rooms;
create policy data_rooms_read on public.data_rooms for select to authenticated
using (public.has_domain_access(workspace_id,'investments','read',project_id));
drop policy if exists data_room_documents_read on public.data_room_documents;
create policy data_room_documents_read on public.data_room_documents for select to authenticated
using (exists(select 1 from public.data_rooms r where r.id = data_room_documents.data_room_id and public.has_domain_access(r.workspace_id,'investments','read',r.project_id)));
drop policy if exists data_room_access_logs_read on public.data_room_access_logs;
create policy data_room_access_logs_read on public.data_room_access_logs for select to authenticated
using (exists(select 1 from public.data_rooms r where r.id = data_room_access_logs.data_room_id and public.has_domain_access(r.workspace_id,'investments','read',r.project_id)));

revoke insert, update, delete on public.approval_workflows from anon, authenticated;
revoke insert, update, delete on public.approval_workflow_steps from anon, authenticated;
revoke insert, update, delete on public.approval_instances from anon, authenticated;
revoke insert, update, delete on public.approval_step_decisions from anon, authenticated;
revoke insert, update, delete on public.document_signatures from anon, authenticated;
revoke insert, update, delete on public.document_retention_policies from anon, authenticated;
revoke insert, update, delete on public.data_rooms from anon, authenticated;
revoke insert, update, delete on public.data_room_documents from anon, authenticated;
revoke insert, update, delete on public.data_room_access_logs from anon, authenticated;

insert into public.app_schema_versions(version)
values ('20260822_document_approval_governance')
on conflict(version) do update set applied_at = excluded.applied_at;

commit;
