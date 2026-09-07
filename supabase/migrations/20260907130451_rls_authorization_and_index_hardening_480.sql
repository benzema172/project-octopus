drop policy if exists "project_tasks_project_member" on public.project_tasks;
drop policy if exists "members can read projects" on public.projects;
drop policy if exists "users can read own memberships" on public.workspace_members;
drop policy if exists "workspace members can read workspaces" on public.workspaces;

drop policy if exists stock_item_location_assignments_write on public.stock_item_location_assignments;
create policy stock_item_location_assignments_insert on public.stock_item_location_assignments for insert to authenticated with check (private.has_domain_access(workspace_id, 'warehouse', 'write', null));
create policy stock_item_location_assignments_update on public.stock_item_location_assignments for update to authenticated using (private.has_domain_access(workspace_id, 'warehouse', 'write', null)) with check (private.has_domain_access(workspace_id, 'warehouse', 'write', null));
create policy stock_item_location_assignments_delete on public.stock_item_location_assignments for delete to authenticated using (private.has_domain_access(workspace_id, 'warehouse', 'write', null));

drop policy if exists warehouse_ai_decision_events_write on public.warehouse_ai_decision_events;
create policy warehouse_ai_decision_events_insert on public.warehouse_ai_decision_events for insert to authenticated with check (private.has_domain_access(workspace_id, 'warehouse', 'write', null));
create policy warehouse_ai_decision_events_update on public.warehouse_ai_decision_events for update to authenticated using (private.has_domain_access(workspace_id, 'warehouse', 'write', null)) with check (private.has_domain_access(workspace_id, 'warehouse', 'write', null));
create policy warehouse_ai_decision_events_delete on public.warehouse_ai_decision_events for delete to authenticated using (private.has_domain_access(workspace_id, 'warehouse', 'write', null));

drop policy if exists warehouse_ai_feedback_write on public.warehouse_ai_feedback;
create policy warehouse_ai_feedback_insert on public.warehouse_ai_feedback for insert to authenticated with check (private.has_domain_access(workspace_id, 'warehouse', 'write', null));
create policy warehouse_ai_feedback_update on public.warehouse_ai_feedback for update to authenticated using (private.has_domain_access(workspace_id, 'warehouse', 'write', null)) with check (private.has_domain_access(workspace_id, 'warehouse', 'write', null));
create policy warehouse_ai_feedback_delete on public.warehouse_ai_feedback for delete to authenticated using (private.has_domain_access(workspace_id, 'warehouse', 'write', null));

drop policy if exists warehouse_locations_write on public.warehouse_locations;
create policy warehouse_locations_insert on public.warehouse_locations for insert to authenticated with check (private.has_domain_access(workspace_id, 'warehouse', 'write', null));
create policy warehouse_locations_update on public.warehouse_locations for update to authenticated using (private.has_domain_access(workspace_id, 'warehouse', 'write', null)) with check (private.has_domain_access(workspace_id, 'warehouse', 'write', null));
create policy warehouse_locations_delete on public.warehouse_locations for delete to authenticated using (private.has_domain_access(workspace_id, 'warehouse', 'write', null));

drop index if exists public.project_tasks_fk_b44cfc1775_idx;
drop index if exists public.project_tasks_fk_c9aa275ab1_idx;
