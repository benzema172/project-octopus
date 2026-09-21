-- Reliability & Speed Core 2.
-- Two hot relational paths were only covered by compound indexes whose leading
-- column is different from the referenced FK. These small indexes keep invoice
-- reconciliation and FIFO provenance predictable as production data grows.

create index if not exists finance_payment_matches_invoice_fk_idx
  on public.finance_payment_matches(invoice_id);

create index if not exists stock_cost_allocations_source_movement_line_fk_idx
  on public.stock_cost_allocations(source_movement_line_id)
  where source_movement_line_id is not null;
