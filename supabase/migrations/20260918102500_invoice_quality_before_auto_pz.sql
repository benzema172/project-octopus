-- Invoice Intake Readiness: stan magazynu zmieniamy dopiero po świeżej,
-- poprawnej kontroli jakości najnowszego źródła kanonicznej faktury.

do $$
begin
  if to_regprocedure('public.auto_receive_purchase_invoice_unguarded_atomic(uuid,uuid,uuid)') is null
     and to_regprocedure('public.auto_receive_purchase_invoice_atomic(uuid,uuid,uuid)') is not null then
    alter function public.auto_receive_purchase_invoice_atomic(uuid, uuid, uuid)
      rename to auto_receive_purchase_invoice_unguarded_atomic;
  end if;
end
$$;

create or replace function public.auto_receive_purchase_invoice_atomic(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quality jsonb;
  v_quality_at timestamptz;
  v_latest_source_at timestamptz;
begin
  select max(greatest(observed_at, updated_at))
    into v_latest_source_at
  from public.invoice_source_observations
  where workspace_id = p_workspace_id
    and invoice_id = p_invoice_id;

  select after_value, created_at
    into v_quality, v_quality_at
  from public.audit_events
  where workspace_id = p_workspace_id
    and event_type = 'invoice.intake_quality_checked'
    and entity_type = 'invoice'
    and entity_id = p_invoice_id::text
  order by created_at desc
  limit 1;

  if v_quality_at is null
     or (v_latest_source_at is not null and v_quality_at < v_latest_source_at) then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'invoice_quality_pending',
      'invoiceId', p_invoice_id,
      'approved', 0,
      'failed', 0,
      'requiresHumanReview', false
    );
  end if;

  if coalesce((v_quality->>'requiresReview')::boolean, true) then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'invoice_quality_review',
      'invoiceId', p_invoice_id,
      'approved', 0,
      'failed', 0,
      'requiresHumanReview', true,
      'qualityScore', nullif(v_quality->>'score','')::numeric
    );
  end if;

  return public.auto_receive_purchase_invoice_unguarded_atomic(
    p_workspace_id,
    p_invoice_id,
    p_actor_id
  );
end;
$$;

create index if not exists idx_audit_events_invoice_quality_lookup
  on public.audit_events(workspace_id, entity_id, created_at desc)
  where event_type = 'invoice.intake_quality_checked'
    and entity_type = 'invoice';

revoke all on function public.auto_receive_purchase_invoice_unguarded_atomic(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.auto_receive_purchase_invoice_atomic(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.auto_receive_purchase_invoice_atomic(uuid, uuid, uuid) to service_role;
