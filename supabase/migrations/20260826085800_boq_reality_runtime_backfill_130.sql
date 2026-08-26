-- Project Octopus 1.3.0 — preserve the legacy BOQ execution quantity used as a fallback by BOQ Reality.
-- Canonical execution data uses quantity_executed; production also carries performed_quantity.

alter table public.boq_items
  add column if not exists performed_quantity numeric;

update public.boq_items
set performed_quantity = coalesce(performed_quantity, quantity_executed)
where performed_quantity is null;
