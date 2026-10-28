-- Prevent invoice + WZ/PZ/MM double receipt during bulk document imports.
-- Finance and AI may create DRAFT movements, never post quantities automatically.
-- Human review must reconcile purchase invoices against delivery/warehouse evidence.
-- Explicit approval flows remain unchanged; existing posted movements are untouched.
create or replace function public.auto_receive_purchase_invoice_atomic(
  p_workspace_id uuid,
  p_invoice_id uuid,
  p_actor_id uuid default null::uuid
) returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_invoice public.invoices%rowtype;
  v_quality jsonb;
  v_quality_at timestamptz;
  v_pending integer;
  v_related integer;
  v_candidates jsonb;
begin
  select * into v_invoice from public.invoices
    where id=p_invoice_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Faktura nie należy do firmy.'; end if;

  if v_invoice.direction is distinct from 'purchase' then
    return jsonb_build_object('skipped',true,'reason','not_purchase_invoice',
      'invoiceId',p_invoice_id,'approved',0,'failed',0,'requiresHumanReview',false);
  end if;

  select ev.after_value, ev.created_at into v_quality, v_quality_at
  from public.audit_events ev
  where ev.workspace_id=p_workspace_id
    and ev.event_type='invoice.intake_quality_checked'
    and ev.entity_type='invoice' and ev.entity_id=p_invoice_id::text
  order by ev.created_at desc limit 1;

  if v_quality_at is null or coalesce((v_quality->>'requiresReview')::boolean,true) then
    return jsonb_build_object('skipped',true,'reason','invoice_quality_pending_or_review',
      'invoiceId',p_invoice_id,'approved',0,'failed',0,'requiresHumanReview',true);
  end if;

  -- Keep all invoice-generated PZ in draft until explicitly reconciled.
  select count(*)::integer into v_pending
  from public.stock_movements sm
  where sm.workspace_id=p_workspace_id
    and sm.source_invoice_id=p_invoice_id
    and upper(trim(sm.movement_type))='PZ'
    and sm.status='draft';

  if v_pending=0 then
    return jsonb_build_object('skipped',true,'reason','no_unapproved_invoice_receipts',
      'invoiceId',p_invoice_id,'approved',0,'failed',0,'requiresHumanReview',false);
  end if;

  -- Surface the other receipts/transfers that may represent the same delivery.
  -- Matching is conservative: supplier and/or common procurement trace, without
  -- claiming an AI-suggested match is sufficient to change physical stock.
  with possible as (
    select sm.id,sm.document_number,sm.movement_type,sm.status,sm.source_document_id,
      case when sm.counterparty_id is not distinct from v_invoice.counterparty_id
             and v_invoice.counterparty_id is not null then true else false end as supplier_match
    from public.stock_movements sm
    where sm.workspace_id=p_workspace_id
      and sm.source_invoice_id is distinct from p_invoice_id
      and sm.movement_type in ('PZ','WZ','MM')
      and sm.status in ('draft','approved')
      and (
        (v_invoice.counterparty_id is not null and sm.counterparty_id=v_invoice.counterparty_id)
        or (v_invoice.document_id is not null and sm.source_document_id=v_invoice.document_id)
        or (nullif(trim(v_invoice.invoice_number),'') is not null and sm.document_number=v_invoice.invoice_number)
      )
    order by sm.created_at desc
    limit 20
  )
  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'movementId',id,'documentNumber',document_number,
      'movementType',movement_type,'status',status,'supplierMatch',supplier_match
    )), '[]'::jsonb)
  into v_related,v_candidates
  from possible;

  return jsonb_build_object(
    'skipped',true,
    'reason','invoice_warehouse_reconciliation_required',
    'invoiceId',p_invoice_id,
    'approved',0,'failed',0,
    'draftReceipts',v_pending,
    'relatedMovementCount',v_related,
    'relatedMovements',v_candidates,
    'requiresHumanReview',true,
    'stockChanged',false
  );
end;
$function$;
