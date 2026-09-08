drop index if exists public.stock_movements_counterparty_idx;
create index if not exists stock_movements_counterparty_idx
  on public.stock_movements(workspace_id, counterparty_id);
