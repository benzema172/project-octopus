-- Security hardening after full-system audit (2026-09-13).
-- Document Flow must obey the caller's RLS context instead of the view owner's privileges.
-- Internal SECURITY DEFINER helpers used only by triggers / server-side pipelines must not be callable
-- directly by anon/authenticated PostgREST clients.

alter view public.document_flow_v2 set (security_invoker = true);

revoke execute on function public.auto_receive_purchase_invoice_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.auto_receive_purchase_invoice_atomic(uuid, uuid, uuid)
  to service_role;

revoke execute on function public.prevent_redundant_receipt_price_observation()
  from public, anon, authenticated;
revoke execute on function public.cleanup_redundant_receipt_price_after_invoice()
  from public, anon, authenticated;
revoke execute on function public.reconcile_approved_business_document_proposals()
  from public, anon, authenticated;

-- Trigger execution remains valid after these revokes. The functions are SECURITY DEFINER and are
-- invoked by their database triggers / owning server-side routines, not directly from the browser.

insert into public.app_schema_versions(version, applied_at)
values ('20260913_full_app_audit_hardening', now())
on conflict (version) do update set applied_at = excluded.applied_at;
