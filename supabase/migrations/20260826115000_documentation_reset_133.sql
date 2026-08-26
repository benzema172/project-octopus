-- Project Octopus 1.3.3 — Documentation Reset.
-- Removes uploaded-document records and AI knowledge derived from the previous document set.
-- Manual operational data (BOQ, finance, warehouse, fleet, HR, etc.) is preserved; document/source FKs
-- on those records are cleared by their existing ON DELETE SET NULL rules.

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

  -- Remove provenance links while their source identifiers still exist.
  delete from public.entity_source_links
  where document_id is not null
     or document_version_id is not null
     or source_reference_id is not null;

  -- Brain must relearn from the new documentation set instead of mixing old AI facts with new files.
  -- project_fact_versions are removed by ON DELETE CASCADE from project_facts.
  delete from public.project_facts where created_by_ai is true;

  -- These two tables use RESTRICT against document/document_version and therefore must be cleared first.
  delete from public.data_room_documents where document_id is not null or document_version_id is not null;
  delete from public.document_signatures where document_id is not null or document_version_id is not null;

  -- Document-specific quality history is part of the reset, not operational business history.
  delete from public.ai_quality_events where document_id is not null or document_version_id is not null;

  -- Cascades clear versions, extraction/text/page/chunk data, classifications, processing jobs/events,
  -- packages, module proposals, source references, revision/change analysis, intake data and AI review links.
  -- Operational module references configured with ON DELETE SET NULL are preserved without stale provenance.
  delete from public.documents;

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
