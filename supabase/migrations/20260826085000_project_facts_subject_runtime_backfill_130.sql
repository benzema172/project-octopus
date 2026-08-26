-- Project Octopus 1.3.0 — make project_facts.subject explicit in clean migration chains.
-- Production already has this legacy-compatible column; ADD IF NOT EXISTS keeps the migration idempotent.

alter table public.project_facts
  add column if not exists subject text;

update public.project_facts
set subject = coalesce(
  nullif(btrim(value_json ->> 'label'), ''),
  nullif(btrim(fact_type), ''),
  'Fakt projektu'
)
where nullif(btrim(subject), '') is null;
