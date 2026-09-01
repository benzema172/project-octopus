alter table public.templates add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.templates add column if not exists status text not null default 'draft';
alter table public.templates add column if not exists description text;

create or replace function public.template_insert_storage_compat_v2()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.object_key is null or btrim(new.object_key) = '' then
    new.object_key := 'pending/' || gen_random_uuid()::text;
  end if;
  if new.created_by is null and new.owner_id is not null then
    new.created_by := new.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_template_insert_storage_compat_v2 on public.templates;
create trigger trg_template_insert_storage_compat_v2
before insert on public.templates
for each row execute function public.template_insert_storage_compat_v2();

create or replace function public.sync_template_storage_from_document_version_v2()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.templates t
  set object_provider = 'r2',
      bucket_name = v.r2_bucket,
      object_key = v.r2_object_key,
      mime_type = v.mime_type,
      updated_at = now()
  from public.document_versions v
  where t.id = new.template_id
    and v.id = new.document_version_id
    and (t.object_key is null or t.object_key like 'pending/%');
  return new;
end;
$$;

drop trigger if exists trg_sync_template_storage_from_document_version_v2 on public.template_versions;
create trigger trg_sync_template_storage_from_document_version_v2
after insert or update of document_version_id on public.template_versions
for each row execute function public.sync_template_storage_from_document_version_v2();

create or replace function public.materialize_document_template_v2(
  p_workspace_id uuid,
  p_document_version_id uuid,
  p_actor_id uuid default null
)
returns table(template_id uuid, template_version_id uuid, template_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.document_versions%rowtype;
  v_document public.documents%rowtype;
  v_classification record;
  v_existing record;
  v_template_id uuid;
  v_template_version_id uuid;
  v_name text;
begin
  select * into v_version
  from public.document_versions
  where id = p_document_version_id;
  if not found then raise exception 'Nie znaleziono wersji dokumentu.'; end if;

  select * into v_document
  from public.documents
  where id = v_version.document_id and workspace_id = p_workspace_id;
  if not found then raise exception 'Dokument nie należy do aktywnej firmy.'; end if;

  select category, subcategory, confidence, rationale, status
  into v_classification
  from public.document_classifications
  where document_version_id = p_document_version_id
  order by (status = 'approved') desc, created_at desc
  limit 1;

  if coalesce(v_classification.category, v_document.category, '') <> 'template' then
    raise exception 'Dokument nie jest sklasyfikowany jako wzór.';
  end if;

  select tv.id, tv.template_id, tv.status into v_existing
  from public.template_versions tv
  join public.templates t on t.id = tv.template_id
  where tv.document_version_id = p_document_version_id
    and t.workspace_id = p_workspace_id
  order by tv.created_at desc
  limit 1;
  if found then
    return query select v_existing.template_id::uuid, v_existing.id::uuid, v_existing.status::text;
    return;
  end if;

  v_name := regexp_replace(coalesce(v_version.file_name, v_document.name, 'Wzór dokumentu'), '\.[^.]+$', '');

  insert into public.templates(
    workspace_id, name, template_type, object_provider, bucket_name, object_key, mime_type,
    schema_json, is_active, created_by, owner_id, status, description, quarantine_status
  ) values (
    p_workspace_id,
    v_name,
    coalesce(nullif(v_classification.subcategory, ''), 'document'),
    'r2', v_version.r2_bucket, v_version.r2_object_key, v_version.mime_type,
    jsonb_build_object(
      'source', 'document_flow_v2',
      'documentId', v_document.id,
      'documentVersionId', p_document_version_id,
      'classificationConfidence', coalesce(v_classification.confidence, v_document.ai_confidence)
    ),
    true, p_actor_id, p_actor_id, 'draft', v_classification.rationale, 'internal'
  ) returning id into v_template_id;

  insert into public.template_versions(
    workspace_id, template_id, document_version_id, version_number, status, test_payload
  ) values (
    p_workspace_id, v_template_id, p_document_version_id, 1, 'draft',
    jsonb_build_object(
      'source', 'document_flow_v2',
      'classification', coalesce(v_classification.category, v_document.category),
      'confidence', coalesce(v_classification.confidence, v_document.ai_confidence),
      'rationale', v_classification.rationale
    )
  ) returning id into v_template_version_id;

  insert into public.template_fields(
    workspace_id, template_version_id, field_key, label, field_type, source_path,
    required, default_value, sort_order
  )
  select
    p_workspace_id,
    v_template_version_id,
    left(regexp_replace(coalesce(nullif(p.natural_key, ''), nullif(p.proposal_type, ''), 'field_' || row_number() over ()), '[^a-zA-Z0-9_]+', '_', 'g'), 80),
    coalesce(nullif(p.title, ''), 'Pole wzoru'),
    'text',
    null,
    false,
    p.payload,
    row_number() over ()::int - 1
  from public.document_module_proposals p
  where p.document_version_id = p_document_version_id
    and p.module = 'data'
  order by p.created_at
  limit 100;

  insert into public.audit_events(
    workspace_id, project_id, actor_id, actor_type, event_type, entity_type, entity_id, after_value
  ) values (
    p_workspace_id, v_document.project_id, p_actor_id,
    case when p_actor_id is null then 'system' else 'user' end,
    'document.flow_materialized', 'document', v_document.id,
    jsonb_build_object(
      'document_version_id', p_document_version_id,
      'category', 'template',
      'destination', 'Octopus Brain → Wzory',
      'template_id', v_template_id,
      'template_version_id', v_template_version_id,
      'status', 'draft'
    )
  );

  return query select v_template_id, v_template_version_id, 'draft'::text;
end;
$$;

revoke all on function public.materialize_document_template_v2(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.materialize_document_template_v2(uuid,uuid,uuid) to service_role;

do $$
declare r record;
begin
  for r in
    select distinct on (dc.document_version_id)
      dc.workspace_id, dc.document_version_id, dc.approved_by
    from public.document_classifications dc
    join public.documents d on d.id = dc.document_id and d.workspace_id = dc.workspace_id
    left join public.template_versions tv on tv.document_version_id = dc.document_version_id
    where dc.category = 'template'
      and dc.status = 'approved'
      and tv.id is null
    order by dc.document_version_id, dc.created_at desc
  loop
    perform public.materialize_document_template_v2(r.workspace_id, r.document_version_id, r.approved_by);
  end loop;
end $$;
