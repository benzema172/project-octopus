-- Clean up indexes/policies introduced by the operational release and cover only hot cross-module foreign keys.

drop policy if exists saved_searches_read on public.saved_searches;
create policy saved_searches_read on public.saved_searches
  for select to authenticated
  using(user_id=(select auth.uid()) and public.is_workspace_member(workspace_id));
drop policy if exists saved_searches_insert on public.saved_searches;
create policy saved_searches_insert on public.saved_searches
  for insert to authenticated
  with check(user_id=(select auth.uid()) and public.is_workspace_member(workspace_id));
drop policy if exists saved_searches_update on public.saved_searches;
create policy saved_searches_update on public.saved_searches
  for update to authenticated
  using(user_id=(select auth.uid()) and public.is_workspace_member(workspace_id))
  with check(user_id=(select auth.uid()) and public.is_workspace_member(workspace_id));
drop policy if exists saved_searches_delete on public.saved_searches;
create policy saved_searches_delete on public.saved_searches
  for delete to authenticated
  using(user_id=(select auth.uid()) and public.is_workspace_member(workspace_id));

-- Keep older canonical indexes and remove duplicates introduced by the audit pass.
drop index if exists public.business_inbox_attention_idx;
drop index if exists public.procurement_matches_attention_idx;
drop index if exists public.qualifications_workspace_valid_idx;
drop index if exists public.vehicle_documents_workspace_valid_idx;

-- Procurement / inventory / execution joins used by cost, trace and action-center flows.
create index if not exists inventory_consumptions_trace_fk_idx on public.inventory_consumptions(procurement_trace_id) where procurement_trace_id is not null;
create index if not exists inventory_cost_layers_trace_fk_idx on public.inventory_cost_layers(procurement_trace_id) where procurement_trace_id is not null;
create index if not exists material_requests_boq_fk2_idx on public.material_requests(boq_item_id) where boq_item_id is not null;
create index if not exists material_requests_wbs_fk2_idx on public.material_requests(wbs_node_id) where wbs_node_id is not null;
create index if not exists schedule_items_project_fk_idx on public.schedule_items(project_id);
create index if not exists schedule_items_boq_fk_idx on public.schedule_items(boq_item_id) where boq_item_id is not null;

-- Revision impact trace.
create index if not exists document_change_impacts_document_fk_idx on public.document_change_impacts(document_id);
create index if not exists document_change_impacts_from_version_fk_idx on public.document_change_impacts(from_version_id);
create index if not exists document_change_impacts_to_version_fk_idx on public.document_change_impacts(to_version_id);

-- HR / fleet controls used by expiry and lifecycle screens.
create index if not exists medical_exams_employee_fk_idx on public.medical_exams(employee_id);
create index if not exists qualifications_employee_fk_idx on public.qualifications(employee_id);
create index if not exists service_orders_vehicle_fk_idx on public.service_orders(vehicle_id);
create index if not exists vehicle_documents_vehicle_fk_idx on public.vehicle_documents(vehicle_id);

-- Reports / notifications used by the automatic operations runner.
create index if not exists report_definitions_project_fk_idx on public.report_definitions(project_id) where project_id is not null;
create index if not exists report_runs_definition_fk_idx on public.report_runs(report_definition_id);
create index if not exists report_runs_project_fk_idx on public.report_runs(project_id) where project_id is not null;
create index if not exists notifications_project_fk_idx on public.notifications(project_id) where project_id is not null;

insert into public.app_schema_versions(version)
values('20260819_performance_cleanup')
on conflict(version) do nothing;
