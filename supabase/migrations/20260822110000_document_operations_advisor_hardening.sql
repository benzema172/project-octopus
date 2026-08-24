begin;

-- Trigger functions execute only through their triggers. They are not public RPCs.
revoke all on function public.trg_capture_project_match_feedback() from public, anon, authenticated;
revoke all on function public.trg_refresh_document_matrix() from public, anon, authenticated;
revoke all on function public.trg_seed_project_document_matrix() from public, anon, authenticated;
revoke all on function public.trg_apply_default_retention() from public, anon, authenticated;
revoke all on function public.trg_apply_document_review_sla() from public, anon, authenticated;
revoke all on function public.trg_enrich_procurement_match() from public, anon, authenticated;
revoke all on function public.trg_protect_governed_document() from public, anon, authenticated;

-- Cover every foreign key added by the document operations suite. Apart from
-- faster joins, these indexes prevent parent deletes/updates from scanning the
-- full child table as document volume grows.
create index if not exists document_intakes_assigned_to_fk_idx on public.document_intakes(assigned_to);
create index if not exists document_packages_project_fk_idx on public.document_packages(project_id);
create index if not exists document_packages_parent_document_fk_idx on public.document_packages(parent_document_id);
create index if not exists document_packages_created_by_fk_idx on public.document_packages(created_by);
create index if not exists document_package_items_workspace_fk_idx on public.document_package_items(workspace_id);
create index if not exists document_package_items_project_fk_idx on public.document_package_items(project_id);
create index if not exists document_package_items_child_document_fk_idx on public.document_package_items(child_document_id);
create index if not exists document_package_items_child_version_fk_idx on public.document_package_items(child_version_id);
create index if not exists document_analysis_segments_workspace_fk_idx on public.document_analysis_segments(workspace_id);
create index if not exists document_analysis_segments_project_fk_idx on public.document_analysis_segments(project_id);
create index if not exists document_ingestion_channels_created_by_fk_idx on public.document_ingestion_channels(created_by);
create index if not exists project_match_aliases_project_fk_idx on public.project_match_aliases(project_id);
create index if not exists project_match_aliases_created_by_fk_idx on public.project_match_aliases(created_by);
create index if not exists project_match_feedback_document_fk_idx on public.project_match_feedback(document_id);
create index if not exists project_match_feedback_proposed_project_fk_idx on public.project_match_feedback(proposed_project_id);
create index if not exists project_match_feedback_selected_project_fk_idx on public.project_match_feedback(selected_project_id);
create index if not exists project_match_feedback_decided_by_fk_idx on public.project_match_feedback(decided_by);
create index if not exists document_review_policies_created_by_fk_idx on public.document_review_policies(created_by);
create index if not exists document_review_policies_assignee_fk_idx on public.document_review_policies(default_assignee);
create index if not exists project_document_requirements_workspace_fk_idx on public.project_document_requirements(workspace_id);
create index if not exists project_document_requirements_source_document_fk_idx on public.project_document_requirements(source_document_id);
create index if not exists project_document_requirements_owner_fk_idx on public.project_document_requirements(owner_id);
create index if not exists project_document_requirements_fulfilled_document_fk_idx on public.project_document_requirements(fulfilled_document_id);
create index if not exists project_document_requirements_accepted_by_fk_idx on public.project_document_requirements(accepted_by);
create index if not exists project_document_requirement_links_workspace_fk_idx on public.project_document_requirement_links(workspace_id);
create index if not exists project_document_requirement_links_project_fk_idx on public.project_document_requirement_links(project_id);
create index if not exists project_document_requirement_links_created_by_fk_idx on public.project_document_requirement_links(created_by);
create index if not exists procurement_matches_boq_fk_idx on public.procurement_matches(boq_item_id);

create index if not exists approval_workflows_created_by_fk_idx on public.approval_workflows(created_by);
create index if not exists approval_workflow_steps_workspace_fk_idx on public.approval_workflow_steps(workspace_id);
create index if not exists approval_instances_project_fk_idx on public.approval_instances(project_id);
create index if not exists approval_instances_workflow_fk_idx on public.approval_instances(workflow_id);
create index if not exists approval_instances_document_version_fk_idx on public.approval_instances(document_version_id);
create index if not exists approval_instances_requested_by_fk_idx on public.approval_instances(requested_by);
create index if not exists approval_step_decisions_workspace_fk_idx on public.approval_step_decisions(workspace_id);
create index if not exists approval_step_decisions_workflow_step_fk_idx on public.approval_step_decisions(workflow_step_id);
create index if not exists approval_step_decisions_decided_by_fk_idx on public.approval_step_decisions(decided_by);
create index if not exists document_signatures_workspace_fk_idx on public.document_signatures(workspace_id);
create index if not exists document_signatures_project_fk_idx on public.document_signatures(project_id);
create index if not exists document_signatures_document_fk_idx on public.document_signatures(document_id);
create index if not exists document_signatures_document_version_fk_idx on public.document_signatures(document_version_id);
create index if not exists document_signatures_workflow_step_fk_idx on public.document_signatures(workflow_step_id);
create index if not exists document_signatures_signer_fk_idx on public.document_signatures(signer_id);
create index if not exists document_retention_policies_created_by_fk_idx on public.document_retention_policies(created_by);
create index if not exists documents_retention_policy_fk_idx on public.documents(retention_policy_id);
create index if not exists data_rooms_project_fk_idx on public.data_rooms(project_id);
create index if not exists data_rooms_created_by_fk_idx on public.data_rooms(created_by);
create index if not exists data_rooms_published_by_fk_idx on public.data_rooms(published_by);
create index if not exists data_rooms_revoked_by_fk_idx on public.data_rooms(revoked_by);
create index if not exists data_room_documents_workspace_fk_idx on public.data_room_documents(workspace_id);
create index if not exists data_room_documents_document_fk_idx on public.data_room_documents(document_id);
create index if not exists data_room_documents_document_version_fk_idx on public.data_room_documents(document_version_id);
create index if not exists data_room_documents_added_by_fk_idx on public.data_room_documents(added_by);
create index if not exists data_room_access_logs_workspace_fk_idx on public.data_room_access_logs(workspace_id);
create index if not exists data_room_access_logs_document_fk_idx on public.data_room_access_logs(document_id);
create index if not exists data_room_access_logs_actor_fk_idx on public.data_room_access_logs(actor_id);

insert into public.app_schema_versions(version)
values ('20260822_document_operations_advisor_hardening')
on conflict(version) do update set applied_at = excluded.applied_at;

commit;
