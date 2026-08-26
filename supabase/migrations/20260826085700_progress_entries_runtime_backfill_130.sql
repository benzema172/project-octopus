-- Project Octopus 1.3.0 — preserve the legacy quantity projection used by BOQ reality.
-- New execution data uses quantity_executed; production also carries quantity.

alter table public.progress_entries
  add column if not exists quantity numeric;

update public.progress_entries
set quantity = coalesce(quantity, quantity_executed)
where quantity is null;
