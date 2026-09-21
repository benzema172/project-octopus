-- Audit Hardening Core 5.
-- Add only FK indexes that are both missing and already exercised by active Octopus workloads.

create index if not exists accounting_entry_lines_project_fk_perf5_idx
  on public.accounting_entry_lines(project_id);

create index if not exists inventory_cost_layers_owner_project_fk_perf5_idx
  on public.inventory_cost_layers(owner_project_id);

create index if not exists material_aliases_stock_item_fk_perf5_idx
  on public.material_aliases(stock_item_id);

create index if not exists notifications_user_fk_perf5_idx
  on public.notifications(user_id);

create index if not exists material_requests_stock_item_fk_perf5_idx
  on public.material_requests(stock_item_id);

create index if not exists stock_movements_counterparty_fk_perf5_idx
  on public.stock_movements(counterparty_id);
