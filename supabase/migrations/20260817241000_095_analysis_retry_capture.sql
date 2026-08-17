begin;

-- Capture every analysis independently of application code.
create or replace function public.capture_document_analysis_quality()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_workspace uuid;
  v_project uuid;
begin
  select d.workspace_id,coalesce(new.proposed_project_id,d.project_id) into v_workspace,v_project
  from public.documents d where d.id=new.document_id;
  if v_workspace is not null then
    insert into public.ai_quality_events(
      workspace_id,project_id,document_id,document_version_id,entity_type,entity_id,event_type,
      model_name,prompt_version,schema_version,category,confidence,payload
    ) values (
      v_workspace,v_project,new.document_id,new.document_version_id,'document',new.document_id::text,'analysis',
      new.model_name,'octopus-document-v1',new.schema_version,new.category,new.confidence,
      jsonb_build_object('rationale',new.rationale,'classification_id',new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists document_analysis_quality_trigger on public.document_classifications;
create trigger document_analysis_quality_trigger after insert on public.document_classifications
for each row execute function public.capture_document_analysis_quality();

-- Retry-safe evidence: unfulfilled derivative requirements are removed together with
-- their source reference. Accepted evidence is preserved and the FK may become NULL.
create or replace function public.cleanup_unfulfilled_evidence_before_source_delete()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  delete from public.evidence_requirements
  where source_reference_id=old.id
    and public.octopus_status_group(status) not in ('done','inactive');
  return old;
end;
$$;

drop trigger if exists source_reference_retry_evidence_cleanup on public.source_references;
create trigger source_reference_retry_evidence_cleanup before delete on public.source_references
for each row execute function public.cleanup_unfulfilled_evidence_before_source_delete();

insert into public.app_schema_versions(version) values ('20260817_095_analysis_retry_capture')
on conflict(version) do update set applied_at=excluded.applied_at;
commit;
