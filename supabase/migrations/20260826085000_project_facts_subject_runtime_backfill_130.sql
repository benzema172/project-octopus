-- Project Octopus 1.3.0 — make the project_facts contract explicit in clean migration chains.
-- Production already contains these compatibility fields; ADD IF NOT EXISTS keeps the migration idempotent.

alter table public.project_facts
  add column if not exists subject text,
  add column if not exists value_number numeric,
  add column if not exists unit text,
  add column if not exists status text,
  add column if not exists review_status public.review_status;

update public.project_facts
set subject = coalesce(
  nullif(btrim(value_json ->> 'label'), ''),
  nullif(btrim(fact_type), ''),
  'Fakt projektu'
)
where nullif(btrim(subject), '') is null;

update public.project_facts
set status = coalesce(nullif(btrim(status), ''), review_status::text, 'approved')
where nullif(btrim(status), '') is null;
