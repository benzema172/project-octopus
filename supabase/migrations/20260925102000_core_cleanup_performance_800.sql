-- Core Cleanup & Performance 8.0
-- Targeted database cleanup from the 2026-09-25 full application audit.
-- Keep this migration conservative: only an exact duplicate index is removed,
-- while FK paths reported by the live Supabase advisor receive covering indexes.

drop index if exists public.document_texts_search_vector_perf13_idx;

create index if not exists warehouse_integration_secrets_workspace_fk_idx
  on private.warehouse_integration_secrets(workspace_id);

create index if not exists accounting_ai_suggestions_entry_fk_idx
  on public.accounting_ai_suggestions(entry_id);
create index if not exists approvals_assigned_to_fk_idx
  on public.approvals(assigned_to);
create index if not exists boq_version_items_project_fk_idx
  on public.boq_version_items(project_id);
create index if not exists domain_role_grants_project_fk_idx
  on public.domain_role_grants(project_id);
create index if not exists domain_role_grants_user_fk_idx
  on public.domain_role_grants(user_id);
create index if not exists finance_cashflow_items_project_fk_idx
  on public.finance_cashflow_items(project_id);
create index if not exists fleet_positions_vehicle_fk_idx
  on public.fleet_positions(vehicle_id);
create index if not exists inventory_consumptions_project_fk_idx
  on public.inventory_consumptions(project_id);
create index if not exists process_deviations_project_fk_idx
  on public.process_deviations(project_id);
create index if not exists project_finance_snapshots_project_fk_idx
  on public.project_finance_snapshots(project_id);
create index if not exists purchase_order_lines_boq_item_fk_idx
  on public.purchase_order_lines(boq_item_id);
create index if not exists stock_item_location_assignments_location_fk_idx
  on public.stock_item_location_assignments(warehouse_location_id);
create index if not exists stock_lots_stock_item_fk_idx
  on public.stock_lots(stock_item_id);
create index if not exists templates_owner_fk_idx
  on public.templates(owner_id);
create index if not exists warehouse_ai_decision_events_line_fk_idx
  on public.warehouse_ai_decision_events(ai_line_id);
create index if not exists warehouse_ai_feedback_candidate_item_fk_idx
  on public.warehouse_ai_feedback(candidate_stock_item_id);
create index if not exists warehouse_locations_parent_fk_idx
  on public.warehouse_locations(parent_id);
create index if not exists warehouse_locations_warehouse_fk_idx
  on public.warehouse_locations(warehouse_id);
create index if not exists warehouse_logistic_unit_items_unit_fk_idx
  on public.warehouse_logistic_unit_items(logistic_unit_id);
create index if not exists warehouse_logistic_units_warehouse_fk_idx
  on public.warehouse_logistic_units(warehouse_id);
create index if not exists warehouse_return_lines_return_fk_idx
  on public.warehouse_return_lines(return_id);
create index if not exists warehouse_tasks_warehouse_fk_idx
  on public.warehouse_tasks(warehouse_id);
create index if not exists wbs_dependencies_successor_fk_idx
  on public.wbs_dependencies(successor_id);

-- Internal-only tables intentionally have RLS without user policies.
-- Make the server-only contract explicit without changing service_role access.
revoke all on table public.ai_action_log from anon, authenticated;
revoke all on table public.ai_briefings from anon, authenticated;
revoke all on table public.ai_confidence_stats from anon, authenticated;
revoke all on table public.ai_workspace_policies from anon, authenticated;
revoke all on table public.app_schema_versions from anon, authenticated;
revoke all on table public.invoice_source_documents from anon, authenticated;
revoke all on table public.warehouse_pdf_ai_chunks from anon, authenticated;
