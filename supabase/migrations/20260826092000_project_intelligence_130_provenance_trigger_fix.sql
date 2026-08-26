-- Project Octopus 1.3.0: keep generic provenance trigger safe for rows without confidence.
create or replace function public.sync_entity_source_link()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  ws uuid;
  entity_kind text;
  source_id uuid;
  project_uuid uuid;
  entity_uuid uuid;
  entity_confidence numeric;
begin
  entity_kind := tg_argv[0];
  project_uuid := new.project_id;
  entity_uuid := new.id;
  source_id := new.source_reference_id;
  if source_id is null or project_uuid is null then return new; end if;
  if entity_kind='project_fact' then
    entity_confidence := nullif(to_jsonb(new)->>'confidence','')::numeric;
  else
    entity_confidence := null;
  end if;
  select workspace_id into ws from public.projects where id=project_uuid;
  if ws is null then return new; end if;
  insert into public.entity_source_links(workspace_id,project_id,entity_type,entity_id,source_reference_id,document_id,document_version_id,source_locator,source_excerpt,confidence)
  select ws,project_uuid,entity_kind,entity_uuid,sr.id,sr.document_id,sr.document_version_id,
    coalesce(sr.locator,'{}'::jsonb)||jsonb_build_object('page',coalesce(sr.page_number,sr.page_no),'section',sr.section_label),
    coalesce(sr.quote,sr.quote_excerpt),entity_confidence
  from public.source_references sr where sr.id=source_id
  on conflict(entity_type,entity_id,source_reference_id,relation_kind) do update set
    document_id=excluded.document_id,document_version_id=excluded.document_version_id,source_locator=excluded.source_locator,
    source_excerpt=excluded.source_excerpt,confidence=excluded.confidence;
  return new;
end;
$$;
