begin;

create or replace function public.guard_purchase_order_line_against_wm()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_req_stock uuid;
  v_req_boq uuid;
  v_req_status public.review_status;
begin
  select mr.stock_item_id,mr.boq_item_id,mr.status
  into v_req_stock,v_req_boq,v_req_status
  from public.purchase_orders po
  left join public.material_requests mr on mr.id=po.source_request_id
  where po.id=new.purchase_order_id;
  if not found then raise exception 'Zamówienie nadrzędne nie istnieje.'; end if;
  if v_req_status is not null then
    if v_req_status<>'approved' then raise exception 'PO może korzystać tylko z zatwierdzonego WM.'; end if;
    if v_req_stock is null then raise exception 'Zatwierdzony WM nie ma kanonicznej kartoteki materiałowej. Uzupełnij WM przed zamówieniem.'; end if;
    if new.stock_item_id is distinct from v_req_stock then raise exception 'Materiał PO różni się od materiału zatwierdzonego w WM.'; end if;
    if v_req_boq is not null and new.boq_item_id is distinct from v_req_boq then raise exception 'BOQ pozycji PO różni się od BOQ zatwierdzonego w WM.'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.set_invoice_line_scope_and_rebuild_atomic(
  p_workspace_id uuid,p_invoice_line_id uuid,p_scope text,p_project_id uuid,p_boq_item_id uuid,p_wbs_node_id uuid,p_cost_code text,p_amount numeric,p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid;v_invoice uuid;
begin
  v_id:=public.set_invoice_line_scope_atomic(p_workspace_id,p_invoice_line_id,p_scope,p_project_id,p_boq_item_id,p_wbs_node_id,p_cost_code,p_amount,p_actor_id);
  select invoice_id into v_invoice from public.invoice_lines where id=p_invoice_line_id and workspace_id=p_workspace_id;
  if v_invoice is not null then perform public.rebuild_invoice_draft_pz_atomic(p_workspace_id,v_invoice); end if;
  return v_id;
end;
$$;
revoke all on function public.set_invoice_line_scope_and_rebuild_atomic(uuid,uuid,text,uuid,uuid,uuid,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.set_invoice_line_scope_and_rebuild_atomic(uuid,uuid,text,uuid,uuid,uuid,text,numeric,uuid) to service_role;

create or replace function public.trg_sync_ksef_business_inbox()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_canonical jsonb;
begin
  v_canonical:=case
    when jsonb_typeof(new.validation->'businessDocument')='object' then new.validation->'businessDocument'
    else jsonb_build_object(
      'documentType','invoice','ksefNumber',new.ksef_number,'documentNumber',new.invoice_number,'direction','purchase',
      'supplierTaxId',new.supplier_nip,'supplierName',new.supplier_name,'grossAmount',new.gross_amount,'currency',new.currency
    )
  end;
  insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,invoice_id,document_type,status,payload,canonical_payload,canonical_version,received_at,processed_at)
  values(new.workspace_id,'ksef',new.ksef_number,new.source_document_id,new.invoice_id,'invoice',case when new.invoice_id is not null then 'processed' when new.source_document_id is not null then 'processing' else 'new' end,jsonb_build_object('invoice_number',new.invoice_number,'supplier_nip',new.supplier_nip,'supplier_name',new.supplier_name,'gross_amount',new.gross_amount,'currency',new.currency),v_canonical,'business-document-v1',new.received_at,case when new.invoice_id is not null then now() else null end)
  on conflict(workspace_id,source_channel,external_key) do update set document_id=excluded.document_id,invoice_id=excluded.invoice_id,status=excluded.status,payload=excluded.payload,canonical_payload=excluded.canonical_payload,canonical_version=excluded.canonical_version,processed_at=excluded.processed_at;
  return new;
end;
$$;

insert into public.app_schema_versions(version)
values ('20260819_flow_integrity_1_1_runtime_guards')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
