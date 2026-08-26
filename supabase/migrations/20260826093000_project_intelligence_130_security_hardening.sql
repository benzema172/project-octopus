-- Project Octopus 1.3.0 security/performance hardening

-- Views must honor caller permissions and RLS.
alter view public.document_processing_state_v set (security_invoker = true);
alter view public.document_package_progress_v set (security_invoker = true);
alter view public.project_provenance_v set (security_invoker = true);
alter view public.document_revision_control_v set (security_invoker = true);
alter view public.brain_fact_latest_v set (security_invoker = true);
alter view public.brain_fact_conflicts_v set (security_invoker = true);
alter view public.boq_reality_v set (security_invoker = true);
alter view public.material_request_workflow_v set (security_invoker = true);
alter view public.material_request_gaps_v set (security_invoker = true);
alter view public.ai_review_exceptions_v set (security_invoker = true);
alter view public.project_intelligence_actions_v set (security_invoker = true);

-- Pin function lookup paths.
alter function public.assign_change_impact_modules() set search_path = public, pg_temp;
alter function public.normalize_revision_family(text) set search_path = public, pg_temp;
alter function public.capture_material_request_event() set search_path = public, pg_temp;
alter function public.capture_processing_job_event() set search_path = public, pg_temp;
alter function public.capture_project_fact_version() set search_path = public, pg_temp;
alter function public.detect_document_revision_candidate() set search_path = public, pg_temp;
alter function public.link_document_revision_candidate() set search_path = public, pg_temp;
alter function public.link_document_version_revision() set search_path = public, pg_temp;
alter function public.refresh_document_package_counts() set search_path = public, pg_temp;
alter function public.sync_entity_source_link() set search_path = public, pg_temp;

-- Trigger-only functions must not be callable through PostgREST RPC.
revoke execute on function public.capture_material_request_event() from public, anon, authenticated;
revoke execute on function public.capture_processing_job_event() from public, anon, authenticated;
revoke execute on function public.capture_project_fact_version() from public, anon, authenticated;
revoke execute on function public.detect_document_revision_candidate() from public, anon, authenticated;
revoke execute on function public.link_document_revision_candidate() from public, anon, authenticated;
revoke execute on function public.link_document_version_revision() from public, anon, authenticated;
revoke execute on function public.refresh_document_package_counts() from public, anon, authenticated;
revoke execute on function public.sync_entity_source_link() from public, anon, authenticated;

-- Preserve member read/write semantics without overlapping permissive SELECT policies.
drop policy if exists document_processing_events_service_write on public.document_processing_events;
create policy document_processing_events_member_insert on public.document_processing_events for insert to public with check (public.is_workspace_member(workspace_id));
create policy document_processing_events_member_update on public.document_processing_events for update to public using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy document_processing_events_member_delete on public.document_processing_events for delete to public using (public.is_workspace_member(workspace_id));

drop policy if exists entity_source_links_write on public.entity_source_links;
create policy entity_source_links_member_insert on public.entity_source_links for insert to public with check (public.is_workspace_member(workspace_id));
create policy entity_source_links_member_update on public.entity_source_links for update to public using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy entity_source_links_member_delete on public.entity_source_links for delete to public using (public.is_workspace_member(workspace_id));

drop policy if exists material_request_events_write on public.material_request_events;
create policy material_request_events_member_insert on public.material_request_events for insert to public with check (public.is_workspace_member(workspace_id));
create policy material_request_events_member_update on public.material_request_events for update to public using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy material_request_events_member_delete on public.material_request_events for delete to public using (public.is_workspace_member(workspace_id));

drop policy if exists project_fact_versions_write on public.project_fact_versions;
create policy project_fact_versions_member_insert on public.project_fact_versions for insert to public with check (public.is_workspace_member(workspace_id));
create policy project_fact_versions_member_update on public.project_fact_versions for update to public using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy project_fact_versions_member_delete on public.project_fact_versions for delete to public using (public.is_workspace_member(workspace_id));

-- Cover 1.3.0 foreign keys used by processing, provenance, revisions, requests and Brain history.
create index if not exists document_processing_events_document_version_fk_idx on public.document_processing_events(document_version_id);
create index if not exists document_processing_events_package_fk_idx on public.document_processing_events(package_id);
create index if not exists document_processing_events_processing_job_fk_idx on public.document_processing_events(processing_job_id);
create index if not exists document_processing_events_workspace_fk_idx on public.document_processing_events(workspace_id);
create index if not exists documents_revision_candidate_fk_idx on public.documents(revision_candidate_id);
create index if not exists entity_source_links_document_version_fk_idx on public.entity_source_links(document_version_id);
create index if not exists entity_source_links_source_reference_fk_idx on public.entity_source_links(source_reference_id);
create index if not exists entity_source_links_workspace_fk_idx on public.entity_source_links(workspace_id);
create index if not exists material_request_events_actor_fk_idx on public.material_request_events(actor_id);
create index if not exists material_request_events_project_fk_idx on public.material_request_events(project_id);
create index if not exists material_request_events_workspace_fk_idx on public.material_request_events(workspace_id);
create index if not exists project_fact_versions_source_reference_fk_idx on public.project_fact_versions(source_reference_id);
create index if not exists project_fact_versions_workspace_fk_idx on public.project_fact_versions(workspace_id);
create index if not exists document_generation_sources_document_version_fk_idx on public.document_generation_sources(document_version_id);
