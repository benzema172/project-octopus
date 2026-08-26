-- Project Octopus 1.3.0 — reproduce the production material request shape on clean migration chains.
-- These columns already exist in production; ADD IF NOT EXISTS keeps deployment idempotent.

alter table public.material_requests
  add column if not exists system_id uuid,
  add column if not exists template_id uuid,
  add column if not exists number text,
  add column if not exists manufacturer text,
  add column if not exists product_name text,
  add column if not exists model text,
  add column if not exists proposed_use text,
  add column if not exists compliance_summary text,
  add column if not exists ai_confidence numeric,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists generated_source_key text,
  add column if not exists source_requirement_id uuid,
  add column if not exists submitted_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text,
  add column if not exists decision_at timestamptz,
  add column if not exists decision_note text,
  add column if not exists stock_item_id uuid,
  add column if not exists boq_item_id uuid,
  add column if not exists wbs_node_id uuid,
  add column if not exists procurement_trace_id uuid,
  add column if not exists request_origin text;

update public.material_requests
set request_origin = coalesce(nullif(btrim(request_origin), ''), 'planned')
where request_origin is null or btrim(request_origin) = '';
