-- Project Octopus 1.3.0 — reproduce the production material knowledge shape on clean migration chains.

alter table public.materials
  add column if not exists system_id uuid,
  add column if not exists category text,
  add column if not exists manufacturer text,
  add column if not exists model text,
  add column if not exists unit text,
  add column if not exists planned_quantity numeric,
  add column if not exists status text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.materials
set status = coalesce(nullif(btrim(status), ''), 'approved')
where status is null or btrim(status) = '';
