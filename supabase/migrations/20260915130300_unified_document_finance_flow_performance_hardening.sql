-- Performance hardening for Unified Document & Finance Flow.
-- Supabase Advisor requires an index led by invoice_id for the FK itself.

create index if not exists idx_invoice_source_observations_invoice_fk
  on public.invoice_source_observations(invoice_id);