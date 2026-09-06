-- Octopus AI 2.0 — foreign-key index hardening.
-- Keep FK lookups and cascading/SET NULL maintenance efficient on both clean
-- installs and the production schema. The warehouse index is intentionally
-- non-partial because FK maintenance must also be covered for all rows.

create index if not exists ai_action_log_project_id_fk_idx
  on public.ai_action_log(project_id);

create index if not exists warehouse_document_reviews_invoice_id_fk_idx
  on public.warehouse_document_reviews(invoice_id);
