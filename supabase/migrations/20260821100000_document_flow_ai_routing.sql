begin;

create or replace function public.canonical_document_category(p_category text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(trim(coalesce(p_category, '')))
    when 'technical' then 'technical'
    when 'project' then 'technical'
    when 'dokumentacja' then 'technical'
    when 'dokument' then 'technical'
    when 'document' then 'technical'
    when 'pdf' then 'technical'
    when 'specification' then 'specification'
    when 'specyfikacja' then 'specification'
    when 'stwior' then 'specification'
    when 'estimate' then 'estimate'
    when 'kosztorys' then 'estimate'
    when 'przedmiar' then 'estimate'
    when 'schedule' then 'schedule'
    when 'harmonogram' then 'schedule'
    when 'protocol' then 'protocol'
    when 'protokol' then 'protocol'
    when 'protokół' then 'protocol'
    when 'application' then 'application'
    when 'wniosek' then 'application'
    when 'contract' then 'contract'
    when 'umowa' then 'contract'
    when 'correspondence' then 'correspondence'
    when 'korespondencja' then 'correspondence'
    when 'invoice' then 'invoice'
    when 'faktura' then 'invoice'
    when 'warehouse' then 'warehouse'
    when 'magazyn' then 'warehouse'
    when 'hr' then 'hr'
    when 'kadry' then 'hr'
    when 'fleet' then 'fleet'
    when 'flota' then 'fleet'
    when 'template' then 'template'
    when 'wzor' then 'template'
    when 'wzór' then 'template'
    when 'report' then 'report'
    when 'raport' then 'report'
    when 'other' then 'other'
    when 'inne' then 'other'
    when 'package' then 'other'
    when 'paczka' then 'other'
    when 'do_weryfikacji' then 'other'
    else 'other'
  end;
$$;

revoke all on function public.canonical_document_category(text) from public, anon, authenticated;
grant execute on function public.canonical_document_category(text) to service_role;

alter table public.document_intakes
  add column if not exists requested_category text,
  add column if not exists category_locked boolean not null default false,
  add column if not exists match_metadata jsonb not null default '{}'::jsonb;

-- Production originated from an older document schema. Keep its required
-- columns populated while making clean installations accept the same RPC.
alter table public.documents
  add column if not exists title text,
  add column if not exists document_type text;

alter table public.document_versions
  add column if not exists version_no integer,
  add column if not exists object_provider text,
  add column if not exists bucket_name text,
  add column if not exists object_key text,
  add column if not exists original_filename text,
  add column if not exists size_bytes bigint,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists document_intakes_review_queue_idx
  on public.document_intakes(workspace_id, status, created_at desc);

create or replace function public.complete_document_upload_v2(
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
  p_uploaded_by uuid,
  p_uploaded_at timestamptz,
  p_category_locked boolean
)
returns table(document_id uuid, version_id uuid, version_number integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.documents%rowtype;
  v_version public.document_versions%rowtype;
  v_version_number integer;
  v_category text := public.canonical_document_category(p_category);
  v_version_inserted boolean := false;
begin
  if p_file_size_bytes <= 0 then
    raise exception 'Invalid file size' using errcode = '22023';
  end if;
  if nullif(trim(p_file_name), '') is null
     or nullif(trim(p_r2_bucket), '') is null
     or nullif(trim(p_r2_object_key), '') is null then
    raise exception 'Incomplete upload metadata' using errcode = '22023';
  end if;

  perform 1 from public.workspaces w where w.id = p_workspace_id;
  if not found then
    raise exception 'Workspace does not exist' using errcode = '42501';
  end if;

  if p_project_id is not null then
    perform 1 from public.projects p
    where p.id = p_project_id and p.workspace_id = p_workspace_id;
    if not found then
      raise exception 'Project does not belong to workspace' using errcode = '42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select d.* into v_document
  from public.documents d
  where d.id = p_document_id
  for update;

  if found then
    if v_document.project_id is distinct from p_project_id
       or v_document.workspace_id is distinct from p_workspace_id then
      raise exception 'Document identity conflict' using errcode = '23505';
    end if;
  else
    insert into public.documents(
      id, workspace_id, project_id, title, document_type, name, category,
      ai_status, review_status, created_by
    ) values (
      p_document_id, p_workspace_id, p_project_id, p_file_name, v_category,
      p_file_name, v_category, 'queued', 'pending', p_uploaded_by
    );
  end if;

  select dv.* into v_version
  from public.document_versions dv
  where dv.id = p_version_id;

  if found then
    if v_version.document_id is distinct from p_document_id
       or coalesce(v_version.r2_object_key, v_version.object_key) is distinct from p_r2_object_key then
      raise exception 'Document version identity conflict' using errcode = '23505';
    end if;
    v_version_number := coalesce(v_version.version_number, v_version.version_no);
  else
    select coalesce(max(greatest(coalesce(dv.version_number, 0), coalesce(dv.version_no, 0))), 0) + 1
      into v_version_number
    from public.document_versions dv
    where dv.document_id = p_document_id;

    insert into public.document_versions(
      id, document_id, project_id, version_no, version_number, object_provider,
      bucket_name, object_key, original_filename, mime_type, size_bytes, created_by,
      file_name, file_size_bytes, r2_bucket, r2_object_key, r2_etag, sha256,
      upload_status, uploaded_by, uploaded_at
    ) values (
      p_version_id, p_document_id, p_project_id, v_version_number, v_version_number, 'r2',
      p_r2_bucket, p_r2_object_key, p_file_name, p_mime_type, p_file_size_bytes, p_uploaded_by,
      p_file_name, p_file_size_bytes, p_r2_bucket, p_r2_object_key, p_r2_etag, p_sha256,
      'uploaded', p_uploaded_by, p_uploaded_at
    );
    v_version_inserted := true;
  end if;

  if v_version_inserted or v_document.current_version_id is null then
    update public.documents
    set current_version_id = p_version_id,
        category = v_category,
        ai_status = 'queued',
        review_status = 'pending',
        approved_by = null,
        approved_at = null,
        updated_at = p_uploaded_at
    where id = p_document_id;
  end if;

  insert into public.document_intakes(
    workspace_id, document_id, proposed_project_id, channel, status,
    suggested_category, requested_category, category_locked, match_metadata,
    created_by, decided_by, decided_at, decision_note
  ) values (
    p_workspace_id, p_document_id, p_project_id,
    case when p_project_id is null then 'company_upload' else 'project_upload' end,
    'queued', v_category, v_category, coalesce(p_category_locked, false), '{}'::jsonb,
    p_uploaded_by, null, null, null
  )
  on conflict on constraint document_intakes_document_id_key do update set
    proposed_project_id = excluded.proposed_project_id,
    channel = excluded.channel,
    status = 'queued',
    suggested_category = excluded.suggested_category,
    requested_category = excluded.requested_category,
    category_locked = excluded.category_locked,
    match_metadata = '{}'::jsonb,
    decided_by = null,
    decided_at = null,
    decision_note = null;

  insert into public.processing_jobs(
    workspace_id, project_id, document_id, document_version_id,
    job_type, job_key, stage, status, priority, attempt_count, available_at
  ) values (
    p_workspace_id, p_project_id, p_document_id, p_version_id,
    'document_pipeline', 'document-pipeline:' || p_version_id::text,
    'extract', 'queued', 100, 0, now()
  )
  on conflict (job_key) do nothing;

  return query select p_document_id, p_version_id, v_version_number;
end;
$$;

revoke all on function public.complete_document_upload_v2(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,uuid,timestamptz,boolean
) from public, anon, authenticated;
grant execute on function public.complete_document_upload_v2(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,uuid,timestamptz,boolean
) to service_role;

create or replace function public.complete_document_upload(
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
  p_uploaded_by uuid,
  p_uploaded_at timestamptz
)
returns table(document_id uuid, version_id uuid, version_number integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select *
  from public.complete_document_upload_v2(
    p_document_id, p_version_id, p_workspace_id, p_project_id, p_file_name,
    p_category, p_mime_type, p_file_size_bytes, p_r2_bucket, p_r2_object_key,
    p_r2_etag, p_sha256, p_uploaded_by, p_uploaded_at, false
  );
end;
$$;

revoke all on function public.complete_document_upload(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,uuid,timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_document_upload(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,uuid,timestamptz
) to service_role;

update public.documents
set category = public.canonical_document_category(category)
where category is distinct from public.canonical_document_category(category);

update public.document_classifications
set category = public.canonical_document_category(category)
where category is distinct from public.canonical_document_category(category);

update public.document_intakes
set suggested_category = public.canonical_document_category(suggested_category),
    requested_category = case
      when requested_category is not null then public.canonical_document_category(requested_category)
      else public.canonical_document_category(suggested_category)
    end
where suggested_category is not null or requested_category is not null;

insert into public.document_intakes(
  workspace_id, document_id, proposed_project_id, channel, status,
  suggested_category, requested_category, category_locked, match_metadata,
  created_by, created_at
)
select
  d.workspace_id,
  d.id,
  d.project_id,
  case when d.project_id is null then 'company_upload' else 'project_upload' end,
  case
    when d.ai_status = 'error' then 'error'
    when d.ai_status = 'review' then 'review'
    when d.ai_status = 'ready' then 'ready'
    else 'queued'
  end,
  public.canonical_document_category(d.category),
  public.canonical_document_category(d.category),
  false,
  jsonb_build_object('backfilled', true),
  d.created_by,
  d.created_at
from public.documents d
where d.workspace_id is not null
  and exists (select 1 from public.document_versions dv where dv.document_id = d.id)
  and not exists (select 1 from public.document_intakes di where di.document_id = d.id)
on conflict on constraint document_intakes_document_id_key do nothing;

insert into public.processing_jobs(
  workspace_id, project_id, document_id, document_version_id,
  job_type, job_key, stage, status, priority, attempt_count,
  available_at, finished_at
)
select
  d.workspace_id,
  coalesce(dv.project_id, d.project_id),
  d.id,
  dv.id,
  'document_pipeline',
  'document-pipeline:' || dv.id::text,
  case when dc.id is null then 'extract' else 'complete' end,
  case when dc.id is null then 'queued' else 'succeeded' end,
  100,
  0,
  now(),
  case when dc.id is null then null else now() end
from public.document_versions dv
join public.documents d on d.id = dv.document_id
left join lateral (
  select c.id
  from public.document_classifications c
  where c.document_version_id = dv.id
  order by c.created_at desc
  limit 1
) dc on true
where coalesce(dv.r2_object_key, dv.object_key) is not null
on conflict (job_key) do nothing;

create or replace function public.document_domain(p_category text)
returns text
language sql
immutable
set search_path = public
as $$
  select case public.canonical_document_category(p_category)
    when 'invoice' then 'finance'
    when 'hr' then 'hr'
    when 'fleet' then 'fleet'
    when 'warehouse' then 'warehouse'
    when 'template' then 'templates'
    when 'report' then 'reports'
    else 'investments'
  end;
$$;

create or replace function public.review_document_analysis_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_action text,
  p_category text,
  p_project_id uuid,
  p_project_selection_set boolean,
  p_actor_id uuid,
  p_note text
)
returns table(
  result_document_id uuid,
  result_project_id uuid,
  result_category text,
  result_status text,
  result_document_version_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.documents%rowtype;
  v_classification public.document_classifications%rowtype;
  v_category text;
  v_project_id uuid;
  v_version_id uuid;
  v_next_status text;
  v_reference_ids uuid[];
  v_protocol_ids uuid[];
  v_payload jsonb;
  v_item jsonb;
  v_source_reference_id uuid;
  v_protocol_source_reference_id uuid;
  v_protocol_id uuid;
  v_estimate_import_id uuid;
  v_row_number integer;
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'Unsupported review action' using errcode = '22023';
  end if;

  select d.* into v_document
  from public.documents d
  where d.id = p_document_id and d.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'Document does not belong to workspace' using errcode = '42501';
  end if;

  select dc.* into v_classification
  from public.document_classifications dc
  where dc.document_id = p_document_id
  order by (dc.status = 'proposed') desc, dc.created_at desc
  limit 1;

  v_version_id := coalesce(v_classification.document_version_id, v_document.current_version_id);
  if v_version_id is null then
    raise exception 'Document has no version to review' using errcode = '22023';
  end if;

  select de.payload into v_payload
  from public.document_extractions de
  where de.document_version_id = v_version_id
    and de.extraction_type = 'document_context'
    and de.status <> 'rejected'
  order by de.created_at desc
  limit 1;

  v_category := public.canonical_document_category(
    coalesce(nullif(trim(p_category), ''), v_classification.category, v_document.category)
  );
  v_project_id := case
    when p_project_selection_set then p_project_id
    else coalesce(v_classification.proposed_project_id, v_document.project_id)
  end;

  if v_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = v_project_id and p.workspace_id = p_workspace_id
  ) then
    raise exception 'Selected project does not belong to workspace' using errcode = '42501';
  end if;

  select array_agg(sr.id) into v_reference_ids
  from public.source_references sr
  where sr.document_version_id = v_version_id;

  select array_agg(pr.id) into v_protocol_ids
  from public.protocol_requirements pr
  where pr.trigger_rule ->> 'document_version_id' = v_version_id::text
     or pr.source_reference_id = any(coalesce(v_reference_ids, '{}'::uuid[]));

  if p_action = 'approve' then
    if v_classification.id is null then
      raise exception 'Document has no AI classification to approve' using errcode = '22023';
    end if;
    v_next_status := 'approved';

    update public.document_classifications
    set status = 'rejected', approved_by = p_actor_id, approved_at = now()
    where document_id = p_document_id
      and status = 'proposed'
      and id <> v_classification.id;

    update public.document_classifications
    set category = v_category,
        proposed_project_id = v_project_id,
        status = 'approved',
        approved_by = p_actor_id,
        approved_at = now()
    where id = v_classification.id;

    update public.document_extractions
    set project_id = v_project_id, status = 'approved'
    where document_version_id = v_version_id and status = 'proposed';

    if v_category not in ('invoice', 'warehouse')
       and jsonb_typeof(v_payload -> 'businessDocument') = 'object'
       and nullif(v_payload -> 'businessDocument' ->> 'documentType', '') is not null then
      v_payload := jsonb_set(
        jsonb_set(v_payload, '{detectedBusinessDocument}', v_payload -> 'businessDocument', true),
        '{businessDocument}',
        'null'::jsonb,
        true
      );
      update public.document_extractions
      set payload = v_payload
      where document_version_id = v_version_id
        and extraction_type = 'document_context'
        and status = 'approved';
    end if;

    update public.document_texts
    set project_id = v_project_id, updated_at = now()
    where document_version_id = v_version_id;

    update public.document_change_impacts
    set project_id = v_project_id
    where to_version_id = v_version_id and status = 'proposed';

    if v_project_id is not null then
      update public.source_references
      set project_id = v_project_id
      where document_version_id = v_version_id;

      update public.project_facts
      set project_id = v_project_id,
          status = 'approved',
          approved_by = p_actor_id,
          approved_at = now()
      where source_reference_id = any(coalesce(v_reference_ids, '{}'::uuid[]))
        and status = 'proposed';

      update public.project_requirements
      set project_id = v_project_id, status = 'required'
      where source_document_id = p_document_id
        and source_locator ->> 'document_version_id' = v_version_id::text
        and status = 'proposed';

      update public.protocol_requirements
      set project_id = v_project_id, status = 'required'
      where id = any(coalesce(v_protocol_ids, '{}'::uuid[]))
        and status = 'proposed';

      update public.evidence_requirements
      set project_id = v_project_id, status = 'missing'
      where (
        protocol_requirement_id = any(coalesce(v_protocol_ids, '{}'::uuid[]))
        or source_reference_id = any(coalesce(v_reference_ids, '{}'::uuid[]))
      ) and status = 'proposed';

      update public.estimate_imports
      set project_id = v_project_id, status = 'review', updated_at = now()
      where document_version_id = v_version_id and status = 'pending_document';

      if jsonb_typeof(v_payload -> 'facts') = 'array'
         and not exists (
           select 1
           from public.project_facts pf
           join public.source_references sr on sr.id = pf.source_reference_id
           where sr.document_version_id = v_version_id
         ) then
        for v_item in select value from jsonb_array_elements(v_payload -> 'facts') loop
          insert into public.source_references(
            project_id, document_id, document_version_id, section_label, quote, locator
          ) values (
            v_project_id,
            p_document_id,
            v_version_id,
            nullif(v_item ->> 'locator', ''),
            left(coalesce(v_item ->> 'quote', ''), 1000),
            jsonb_build_object('label', coalesce(v_item ->> 'locator', ''))
          )
          returning id into v_source_reference_id;

          insert into public.project_facts(
            project_id, fact_type, value_text, value_json, confidence,
            source_reference_id, status, approved_by, approved_at
          ) values (
            v_project_id,
            coalesce(nullif(v_item ->> 'type', ''), nullif(v_item ->> 'label', ''), 'fact'),
            nullif(v_item ->> 'value', ''),
            jsonb_build_object('label', coalesce(v_item ->> 'label', ''), 'unit', coalesce(v_item ->> 'unit', '')),
            coalesce((v_item ->> 'confidence')::numeric, v_classification.confidence),
            v_source_reference_id,
            'approved',
            p_actor_id,
            now()
          );
        end loop;
      end if;

      if jsonb_typeof(v_payload -> 'requiredApplications') = 'array'
         and not exists (
           select 1 from public.project_requirements pr
           where pr.source_document_id = p_document_id
             and pr.source_locator ->> 'document_version_id' = v_version_id::text
             and pr.requirement_type = 'material_application'
         ) then
        for v_item in select value from jsonb_array_elements(v_payload -> 'requiredApplications') loop
          insert into public.project_requirements(
            workspace_id, project_id, requirement_type, title,
            source_document_id, source_locator, status, confidence
          ) values (
            p_workspace_id, v_project_id, 'material_application', trim(both '"' from v_item::text),
            p_document_id, jsonb_build_object('document_version_id', v_version_id),
            'required', v_classification.confidence
          );
        end loop;
      end if;

      if jsonb_typeof(v_payload -> 'workStages') = 'array'
         and not exists (
           select 1 from public.project_requirements pr
           where pr.source_document_id = p_document_id
             and pr.source_locator ->> 'document_version_id' = v_version_id::text
             and pr.requirement_type = 'work_stage'
         ) then
        for v_item in select value from jsonb_array_elements(v_payload -> 'workStages') loop
          insert into public.project_requirements(
            workspace_id, project_id, requirement_type, title,
            source_document_id, source_locator, status, confidence
          ) values (
            p_workspace_id, v_project_id, 'work_stage', trim(both '"' from v_item::text),
            p_document_id, jsonb_build_object('document_version_id', v_version_id),
            'required', v_classification.confidence
          );
        end loop;
      end if;

      if jsonb_typeof(v_payload -> 'requiredProtocols') = 'array'
         and not exists (
           select 1 from public.protocol_requirements pr
           where pr.trigger_rule ->> 'document_version_id' = v_version_id::text
         ) then
        insert into public.source_references(
          project_id, document_id, document_version_id, section_label, quote, locator
        ) values (
          v_project_id, p_document_id, v_version_id, 'Wymagania protokołów', '',
          jsonb_build_object('source', 'document-analysis-v2')
        )
        returning id into v_protocol_source_reference_id;

        for v_item in select value from jsonb_array_elements(v_payload -> 'requiredProtocols') loop
          insert into public.protocol_requirements(
            workspace_id, project_id, protocol_type, title, status,
            source_reference_id, trigger_rule, required_evidence
          ) values (
            p_workspace_id,
            v_project_id,
            left(regexp_replace(lower(trim(both '"' from v_item::text)), '[^a-z0-9]+', '_', 'g'), 80),
            trim(both '"' from v_item::text),
            'required',
            v_protocol_source_reference_id,
            jsonb_build_object('document_version_id', v_version_id, 'ai_confidence', v_classification.confidence),
            '["zakres","lokalizacja","wynik","data","osoby","podpis"]'::jsonb
          )
          returning id into v_protocol_id;

          insert into public.evidence_requirements(
            workspace_id, project_id, protocol_requirement_id, evidence_type,
            title, status, source_reference_id
          ) values (
            p_workspace_id, v_project_id, v_protocol_id, 'protocol',
            trim(both '"' from v_item::text), 'missing', v_protocol_source_reference_id
          );
        end loop;
      end if;

      if v_category = 'estimate'
         and jsonb_typeof(v_payload -> 'boqItems') = 'array'
         and jsonb_array_length(v_payload -> 'boqItems') > 0
         and not exists (
           select 1 from public.estimate_imports ei where ei.document_version_id = v_version_id
         ) then
        insert into public.estimate_imports(
          workspace_id, project_id, document_id, document_version_id, status,
          column_mapping, detected_rows, accepted_rows, warnings, created_by, updated_at
        ) values (
          p_workspace_id,
          v_project_id,
          p_document_id,
          v_version_id,
          'review',
          '{"itemNumber":"AI","description":"AI","quantity":"AI","unit":"AI","unitPrice":"AI","totalPrice":"AI"}'::jsonb,
          jsonb_array_length(v_payload -> 'boqItems'),
          0,
          coalesce(v_payload -> 'warnings', '[]'::jsonb),
          p_actor_id,
          now()
        )
        returning id into v_estimate_import_id;

        v_row_number := 0;
        for v_item in select value from jsonb_array_elements(v_payload -> 'boqItems') loop
          v_row_number := v_row_number + 1;
          insert into public.estimate_import_rows(
            workspace_id, estimate_import_id, source_row, source_payload,
            item_number, description, quantity, unit, unit_price, total_price,
            proposed_wbs_code, confidence, status, validation_errors
          ) values (
            p_workspace_id,
            v_estimate_import_id,
            v_row_number,
            v_item,
            coalesce(nullif(v_item ->> 'itemNumber', ''), v_row_number::text),
            coalesce(nullif(v_item ->> 'description', ''), 'Pozycja ' || v_row_number::text),
            nullif(v_item ->> 'quantity', '')::numeric,
            nullif(v_item ->> 'unit', ''),
            nullif(v_item ->> 'unitPrice', '')::numeric,
            nullif(v_item ->> 'totalPrice', '')::numeric,
            coalesce(nullif(v_item ->> 'wbsCode', ''), '00'),
            nullif(v_item ->> 'confidence', '')::numeric,
            'proposed',
            case when nullif(v_item ->> 'description', '') is null
              then '["Brak opisu pozycji"]'::jsonb else '[]'::jsonb end
          );
        end loop;
      end if;
    else
      update public.project_facts
      set status = 'rejected'
      where source_reference_id = any(coalesce(v_reference_ids, '{}'::uuid[]))
        and status = 'proposed';

      update public.project_requirements
      set status = 'rejected'
      where source_document_id = p_document_id
        and source_locator ->> 'document_version_id' = v_version_id::text
        and status = 'proposed';

      update public.protocol_requirements
      set status = 'rejected'
      where id = any(coalesce(v_protocol_ids, '{}'::uuid[]))
        and status = 'proposed';

      update public.evidence_requirements
      set status = 'rejected'
      where (
        protocol_requirement_id = any(coalesce(v_protocol_ids, '{}'::uuid[]))
        or source_reference_id = any(coalesce(v_reference_ids, '{}'::uuid[]))
      ) and status = 'proposed';

      update public.estimate_imports
      set status = 'rejected', updated_at = now()
      where document_version_id = v_version_id and status = 'pending_document';
    end if;

    update public.document_intakes
    set proposed_project_id = v_project_id,
        suggested_category = v_category,
        status = 'ready',
        decided_by = p_actor_id,
        decided_at = now(),
        decision_note = nullif(trim(p_note), '')
    where document_id = p_document_id;

    update public.document_versions
    set project_id = v_project_id
    where document_id = p_document_id;

    update public.documents
    set category = v_category,
        project_id = v_project_id,
        review_status = 'approved',
        ai_status = 'ready',
        ai_confidence = v_classification.confidence,
        approved_by = p_actor_id,
        approved_at = now(),
        updated_at = now()
    where id = p_document_id;
  else
    v_next_status := 'rejected';

    update public.document_classifications
    set status = 'rejected', approved_by = p_actor_id, approved_at = now()
    where document_version_id = v_version_id and status = 'proposed';

    update public.document_extractions
    set status = 'rejected'
    where document_version_id = v_version_id and status = 'proposed';

    update public.project_facts
    set status = 'rejected'
    where source_reference_id = any(coalesce(v_reference_ids, '{}'::uuid[]))
      and status = 'proposed';

    update public.project_requirements
    set status = 'rejected'
    where source_document_id = p_document_id
      and source_locator ->> 'document_version_id' = v_version_id::text
      and status = 'proposed';

    update public.protocol_requirements
    set status = 'rejected'
    where id = any(coalesce(v_protocol_ids, '{}'::uuid[]))
      and status = 'proposed';

    update public.evidence_requirements
    set status = 'rejected'
    where (
      protocol_requirement_id = any(coalesce(v_protocol_ids, '{}'::uuid[]))
      or source_reference_id = any(coalesce(v_reference_ids, '{}'::uuid[]))
    ) and status = 'proposed';

    update public.estimate_imports
    set status = 'rejected', updated_at = now()
    where document_version_id = v_version_id
      and status in ('pending_document', 'mapping', 'review');

    update public.document_change_impacts
    set status = 'rejected'
    where to_version_id = v_version_id and status = 'proposed';

    update public.template_versions
    set status = 'rejected'
    where document_version_id = v_version_id and status = 'draft';

    update public.document_intakes
    set status = 'rejected',
        decided_by = p_actor_id,
        decided_at = now(),
        decision_note = nullif(trim(p_note), '')
    where document_id = p_document_id;

    update public.documents
    set review_status = 'rejected',
        ai_status = 'rejected',
        approved_by = null,
        approved_at = null,
        updated_at = now()
    where id = p_document_id;
  end if;

  insert into public.ai_review_actions(
    workspace_id, project_id, document_id, entity_type, entity_id,
    action, previous_status, next_status, note, decided_by
  ) values (
    p_workspace_id, v_project_id, p_document_id, 'document', p_document_id::text,
    p_action, v_document.review_status, v_next_status, nullif(trim(p_note), ''), p_actor_id
  );

  insert into public.audit_events(
    workspace_id, project_id, actor_id, actor_type, event_type,
    entity_type, entity_id, before_value, after_value
  ) values (
    p_workspace_id, v_project_id, p_actor_id, 'user',
    'document.' || p_action, 'document', p_document_id::text,
    jsonb_build_object(
      'category', v_document.category,
      'project_id', v_document.project_id,
      'review_status', v_document.review_status
    ),
    jsonb_build_object(
      'category', v_category,
      'project_id', v_project_id,
      'review_status', v_next_status,
      'note', nullif(trim(p_note), '')
    )
  );

  return query
  select p_document_id, v_project_id, v_category, v_next_status, v_version_id;
end;
$$;

revoke all on function public.review_document_analysis_atomic(
  uuid,uuid,text,text,uuid,boolean,uuid,text
) from public, anon, authenticated;
grant execute on function public.review_document_analysis_atomic(
  uuid,uuid,text,text,uuid,boolean,uuid,text
) to service_role;

create or replace function public.trg_orchestrate_approved_business_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_business jsonb;
  v_document_type text;
  v_source_channel text;
begin
  if new.review_status <> 'approved'
     or (old.review_status is not distinct from new.review_status
         and old.project_id is not distinct from new.project_id) then
    return new;
  end if;

  if public.canonical_document_category(new.category) not in ('invoice', 'warehouse') then
    return new;
  end if;

  select de.payload into v_payload
  from public.document_extractions de
  where de.workspace_id = new.workspace_id
    and de.document_id = new.id
    and de.extraction_type = 'document_context'
    and de.status = 'approved'
  order by de.created_at desc
  limit 1;

  v_business := v_payload -> 'businessDocument';
  v_document_type := lower(coalesce(nullif(trim(v_business ->> 'documentType'), ''), ''));
  v_source_channel := coalesce(nullif(new.metadata ->> 'source_channel', ''), 'upload');

  if jsonb_typeof(v_business) <> 'object'
     or (public.canonical_document_category(new.category) = 'invoice'
         and (v_document_type <> 'invoice'
              or coalesce(nullif(trim(v_business ->> 'documentNumber'), ''), nullif(trim(v_business ->> 'ksefNumber'), '')) is null))
     or (public.canonical_document_category(new.category) = 'warehouse'
         and (v_document_type not in ('wz', 'pz', 'delivery')
              or jsonb_array_length(
                case when jsonb_typeof(v_business -> 'lines') = 'array'
                  then v_business -> 'lines' else '[]'::jsonb end
              ) = 0)) then
    insert into public.business_inbox_items(
      workspace_id, source_channel, external_key, document_id, project_id,
      document_type, status, payload, canonical_payload, canonical_version,
      processing_error, received_at, processed_at
    ) values (
      new.workspace_id, v_source_channel, new.id::text, new.id, new.project_id,
      coalesce(nullif(v_document_type, ''), new.category), 'review',
      jsonb_build_object('reason', 'incomplete_ai_extraction'),
      coalesce(v_business, '{}'::jsonb), 'business-document-v1',
      'Analiza AI wymaga uzupełnienia danych biznesowych przed automatycznym księgowaniem lub ruchem magazynowym.',
      new.created_at, now()
    )
    on conflict(workspace_id, source_channel, external_key) do update set
      document_id = excluded.document_id,
      project_id = excluded.project_id,
      document_type = excluded.document_type,
      status = 'review',
      payload = excluded.payload,
      canonical_payload = excluded.canonical_payload,
      canonical_version = excluded.canonical_version,
      processing_error = excluded.processing_error,
      processed_at = excluded.processed_at;
    return new;
  end if;

  begin
    perform public.orchestrate_approved_business_document_atomic(new.workspace_id, new.id, new.approved_by);
  exception when others then
    insert into public.business_inbox_items(
      workspace_id, source_channel, external_key, document_id, project_id,
      document_type, status, payload, canonical_payload, canonical_version,
      processing_error, received_at, processed_at
    ) values (
      new.workspace_id, v_source_channel, new.id::text, new.id, new.project_id,
      coalesce(nullif(v_document_type, ''), new.category), 'error',
      jsonb_build_object('error', sqlerrm), coalesce(v_business, '{}'::jsonb),
      'business-document-v1', sqlerrm, new.created_at, now()
    )
    on conflict(workspace_id, source_channel, external_key) do update set
      document_id = excluded.document_id,
      project_id = excluded.project_id,
      document_type = excluded.document_type,
      status = 'error',
      payload = excluded.payload,
      canonical_payload = excluded.canonical_payload,
      canonical_version = excluded.canonical_version,
      processing_error = excluded.processing_error,
      processed_at = excluded.processed_at;
  end;

  return new;
end;
$$;

revoke all on function public.trg_orchestrate_approved_business_document() from public, anon, authenticated;

insert into public.app_schema_versions(version)
values ('20260821_document_flow_ai_routing')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
