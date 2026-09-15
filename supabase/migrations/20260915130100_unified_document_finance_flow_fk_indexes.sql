-- Unified Document & Finance Flow — FK index hardening

create index if not exists idx_invoice_source_observations_business_inbox_fk
  on public.invoice_source_observations(business_inbox_item_id);
create index if not exists idx_invoice_source_observations_document_fk
  on public.invoice_source_observations(document_id);

create index if not exists idx_finance_document_reviews_business_inbox_fk
  on public.finance_document_reviews(business_inbox_item_id);
create index if not exists idx_finance_document_reviews_candidate_invoice_fk
  on public.finance_document_reviews(candidate_invoice_id);
create index if not exists idx_finance_document_reviews_invoice_fk
  on public.finance_document_reviews(invoice_id);
create index if not exists idx_finance_document_reviews_resolved_by_fk
  on public.finance_document_reviews(resolved_by);
create index if not exists idx_finance_document_reviews_selected_project_fk
  on public.finance_document_reviews(selected_project_id);
create index if not exists idx_finance_document_reviews_suggested_project_fk
  on public.finance_document_reviews(suggested_project_id);
