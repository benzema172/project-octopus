-- Project Octopus 1.3.4 — Documentation Reset Hotfix.
-- Hosted Supabase rejects DELETE without a WHERE clause. Recreate the service-only reset RPC
-- with an explicit PK predicate that still matches every document row.

create or replace function public.reset_documentation_records_133()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_documents bigint := 0;
  v_versions bigint := 0;
  v_ai_facts bigint := 0;
  v_source_links bigint := 0;
  v_quality_events bigint := 0;
begin
  select count(*) into v_documents from public.documents;
  select count(*) into v_versions from public.document_versions;
  select count(*) into v_ai_facts from public.project_facts where created_by_ai is true;
  select count(*) into v_source_links
  from public.entity_source_links
  where document_id is not null
     or document_version_id is not null
     or source_reference_id is not null;
  select count(*) into v_quality_events
  from public.ai_quality_events
  where document_id is not null or document_version_id is not null;

  delete from public.entity_source_links
  where document_id is not null
     or document_version_id is not null
     or source_reference_id is not null;

  delete from public.project_facts where created_by_ai is true;

  delete from public.data_room_documents where document_id is not null or document_version_id is not null;
  delete from public.document_signatures where document_id is not null or document_version_id is not null;
  delete from public.ai_quality_events where document_id is not null or document_version_id is not null;

  -- Primary key is NOT NULL, so this is equivalent to deleting all uploaded-document rows
  -- while complying with hosted Supabase safe-delete enforcement.
  delete from public.documents where id is not null;

  return jsonb_build_object(
    'documentsRemoved', v_documents,
    'versionsRemoved', v_versions,
    'aiFactsRemoved', v_ai_facts,
    'sourceLinksRemoved', v_source_links,
    'qualityEventsRemoved', v_quality_events
  );
end;
$$;

revoke all on function public.reset_documentation_records_133() from public, anon, authenticated;
grant execute on function public.reset_documentation_records_133() to service_role;
