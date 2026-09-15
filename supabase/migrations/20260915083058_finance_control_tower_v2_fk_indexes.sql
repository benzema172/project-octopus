-- Finance Control Tower 2.0 — FK index hardening.
-- Kept as a follow-up migration so production history matches the repository.

create index if not exists idx_fin_alerts_project on public.finance_alerts(project_id);
create index if not exists idx_fin_alerts_resolved_by on public.finance_alerts(resolved_by);
create index if not exists idx_fin_bank_created_by on public.finance_bank_transactions(created_by);
create index if not exists idx_fin_cashflow_created_by on public.finance_cashflow_items(created_by);
create index if not exists idx_fin_match_approved_by on public.finance_payment_matches(approved_by);
create index if not exists idx_fin_match_payment on public.finance_payment_matches(payment_id);
create index if not exists idx_fin_scenarios_created_by on public.finance_scenarios(created_by);
