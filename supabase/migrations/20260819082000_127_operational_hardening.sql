-- Project Octopus operational hardening: P0 security + P1 targeted performance.

-- Trigger-only / internal maintenance functions must never be callable through PostgREST RPC.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'correct_report_snapshot_finance',
    'trg_orchestrate_approved_business_document',
    'trg_rebuild_pz_after_inbox_processed',
    'trg_sync_ksef_business_inbox',
    'trg_sync_material_chain_line',
    'trg_sync_material_chain_movement'
  ] loop
    if to_regprocedure(format('public.%I()', fn)) is not null then
      execute format('revoke all on function public.%I() from public, anon, authenticated', fn);
      execute format('grant execute on function public.%I() to service_role', fn);
    end if;
  end loop;
end $$;

-- Keep access helpers executable by authenticated because RLS policies call them.
-- Split write policies so SELECT does not evaluate duplicate permissive policies.
drop policy if exists accounting_rules_write on public.accounting_rules;
create policy accounting_rules_insert on public.accounting_rules
  for insert to authenticated
  with check (public.has_domain_access(workspace_id, 'finance', 'write', null));
create policy accounting_rules_update on public.accounting_rules
  for update to authenticated
  using (public.has_domain_access(workspace_id, 'finance', 'write', null))
  with check (public.has_domain_access(workspace_id, 'finance', 'write', null));
create policy accounting_rules_delete on public.accounting_rules
  for delete to authenticated
  using (public.has_domain_access(workspace_id, 'finance', 'write', null));

drop policy if exists inventory_consumptions_write on public.inventory_consumptions;
create policy inventory_consumptions_insert on public.inventory_consumptions
  for insert to authenticated
  with check (public.has_domain_access(workspace_id, 'warehouse', 'write', project_id));
create policy inventory_consumptions_update on public.inventory_consumptions
  for update to authenticated
  using (public.has_domain_access(workspace_id, 'warehouse', 'write', project_id))
  with check (public.has_domain_access(workspace_id, 'warehouse', 'write', project_id));
create policy inventory_consumptions_delete on public.inventory_consumptions
  for delete to authenticated
  using (public.has_domain_access(workspace_id, 'warehouse', 'write', project_id));

drop policy if exists inventory_cost_layers_write on public.inventory_cost_layers;
create policy inventory_cost_layers_insert on public.inventory_cost_layers
  for insert to authenticated
  with check (public.has_domain_access(workspace_id, 'warehouse', 'write', owner_project_id));
create policy inventory_cost_layers_update on public.inventory_cost_layers
  for update to authenticated
  using (public.has_domain_access(workspace_id, 'warehouse', 'write', owner_project_id))
  with check (public.has_domain_access(workspace_id, 'warehouse', 'write', owner_project_id));
create policy inventory_cost_layers_delete on public.inventory_cost_layers
  for delete to authenticated
  using (public.has_domain_access(workspace_id, 'warehouse', 'write', owner_project_id));

drop policy if exists procurement_traces_write on public.procurement_traces;
create policy procurement_traces_insert on public.procurement_traces
  for insert to authenticated
  with check (
    public.has_domain_access(workspace_id, 'investments', 'write', project_id)
    or public.has_domain_access(workspace_id, 'warehouse', 'write', project_id)
  );
create policy procurement_traces_update on public.procurement_traces
  for update to authenticated
  using (
    public.has_domain_access(workspace_id, 'investments', 'write', project_id)
    or public.has_domain_access(workspace_id, 'warehouse', 'write', project_id)
  )
  with check (
    public.has_domain_access(workspace_id, 'investments', 'write', project_id)
    or public.has_domain_access(workspace_id, 'warehouse', 'write', project_id)
  );
create policy procurement_traces_delete on public.procurement_traces
  for delete to authenticated
  using (
    public.has_domain_access(workspace_id, 'investments', 'write', project_id)
    or public.has_domain_access(workspace_id, 'warehouse', 'write', project_id)
  );

-- Targeted FK/index coverage for the hot company -> document -> finance -> procurement -> warehouse -> project path.
create index if not exists invoices_document_idx on public.invoices(document_id) where document_id is not null;
create index if not exists invoices_counterparty_idx on public.invoices(counterparty_id) where counterparty_id is not null;
create index if not exists invoices_workspace_due_status_idx on public.invoices(workspace_id, due_date, status);
create index if not exists invoice_lines_stock_item_idx on public.invoice_lines(stock_item_id) where stock_item_id is not null;
create index if not exists payments_invoice_idx on public.payments(invoice_id);

create index if not exists business_inbox_document_idx on public.business_inbox_items(document_id) where document_id is not null;
create index if not exists business_inbox_invoice_idx on public.business_inbox_items(invoice_id) where invoice_id is not null;
create index if not exists business_inbox_project_idx on public.business_inbox_items(project_id) where project_id is not null;
create index if not exists business_inbox_attention_idx on public.business_inbox_items(workspace_id, status, received_at desc);

create index if not exists purchase_orders_project_idx on public.purchase_orders(project_id) where project_id is not null;
create index if not exists purchase_order_lines_stock_item_idx on public.purchase_order_lines(stock_item_id) where stock_item_id is not null;
create index if not exists purchase_order_lines_boq_idx on public.purchase_order_lines(boq_item_id) where boq_item_id is not null;
create index if not exists purchase_order_lines_wbs_idx on public.purchase_order_lines(wbs_node_id) where wbs_node_id is not null;
create index if not exists stock_movement_lines_source_invoice_line_idx on public.stock_movement_lines(source_invoice_line_id) where source_invoice_line_id is not null;
create index if not exists stock_movement_lines_po_line_idx on public.stock_movement_lines(purchase_order_line_id) where purchase_order_line_id is not null;
create index if not exists stock_movements_source_invoice_idx on public.stock_movements(source_invoice_id) where source_invoice_id is not null;

create index if not exists procurement_matches_invoice_line_idx on public.procurement_matches(invoice_line_id);
create index if not exists procurement_matches_project_idx on public.procurement_matches(project_id) where project_id is not null;
create index if not exists procurement_matches_attention_idx on public.procurement_matches(workspace_id, status, updated_at desc);
create index if not exists procurement_traces_project_idx on public.procurement_traces(project_id) where project_id is not null;
create index if not exists procurement_traces_stock_item_idx on public.procurement_traces(stock_item_id) where stock_item_id is not null;
create index if not exists procurement_traces_boq_idx on public.procurement_traces(boq_item_id) where boq_item_id is not null;
create index if not exists procurement_traces_wbs_idx on public.procurement_traces(wbs_node_id) where wbs_node_id is not null;
create index if not exists price_observations_stock_item_idx on public.price_observations(stock_item_id) where stock_item_id is not null;
create index if not exists price_observations_counterparty_idx on public.price_observations(counterparty_id) where counterparty_id is not null;
create index if not exists price_observations_project_idx on public.price_observations(project_id) where project_id is not null;

create index if not exists accounting_entries_project_idx on public.accounting_entries(project_id) where project_id is not null;
create index if not exists accounting_entries_invoice_idx on public.accounting_entries(invoice_id) where invoice_id is not null;
create index if not exists accounting_entries_document_idx on public.accounting_entries(document_id) where document_id is not null;
create index if not exists accounting_entry_lines_account_idx on public.accounting_entry_lines(account_id);
create index if not exists accounting_entry_lines_project_idx on public.accounting_entry_lines(project_id) where project_id is not null;
create index if not exists accounting_entry_lines_invoice_line_idx on public.accounting_entry_lines(invoice_line_id) where invoice_line_id is not null;
create index if not exists accounting_entry_lines_boq_idx on public.accounting_entry_lines(boq_item_id) where boq_item_id is not null;
create index if not exists accounting_entry_lines_wbs_idx on public.accounting_entry_lines(wbs_node_id) where wbs_node_id is not null;

-- HR and fleet project-cost joins / expiry queues.
create index if not exists assignments_employee_idx on public.assignments(employee_id);
create index if not exists assignments_project_idx on public.assignments(project_id) where project_id is not null;
create index if not exists employments_employee_idx on public.employments(employee_id);
create index if not exists timesheets_employee_idx on public.timesheets(employee_id);
create index if not exists timesheets_wbs_idx on public.timesheets(wbs_node_id) where wbs_node_id is not null;
create index if not exists timesheets_workspace_status_date_idx on public.timesheets(workspace_id, status, work_date desc);
create index if not exists medical_exams_workspace_valid_idx on public.medical_exams(workspace_id, valid_until);
create index if not exists qualifications_workspace_valid_idx on public.qualifications(workspace_id, valid_until);
create index if not exists leave_requests_workspace_status_idx on public.leave_requests(workspace_id, status, date_from);

create index if not exists fuel_entries_vehicle_idx on public.fuel_entries(vehicle_id);
create index if not exists fuel_entries_employee_idx on public.fuel_entries(employee_id) where employee_id is not null;
create index if not exists fuel_entries_invoice_idx on public.fuel_entries(invoice_id) where invoice_id is not null;
create index if not exists trips_vehicle_idx on public.trips(vehicle_id);
create index if not exists trips_employee_idx on public.trips(employee_id) where employee_id is not null;
create index if not exists vehicle_cost_rates_vehicle_idx on public.vehicle_cost_rates(vehicle_id);
create index if not exists vehicle_documents_workspace_valid_idx on public.vehicle_documents(workspace_id, valid_until);
create index if not exists service_orders_workspace_due_idx on public.service_orders(workspace_id, next_due_date, status);

-- Document/knowledge hot joins.
create index if not exists document_texts_document_idx on public.document_texts(document_id);
create index if not exists source_references_document_idx on public.source_references(document_id);
create index if not exists source_references_document_version_idx on public.source_references(document_version_id) where document_version_id is not null;
create index if not exists source_references_page_idx on public.source_references(page_id) where page_id is not null;
create index if not exists source_references_chunk_idx on public.source_references(chunk_id) where chunk_id is not null;

insert into public.app_schema_versions(version)
values ('20260819_operational_hardening')
on conflict (version) do nothing;
