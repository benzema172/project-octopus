begin;

create or replace function public.rebuild_invoice_draft_pz_atomic(p_workspace_id uuid,p_invoice_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_inv public.invoices%rowtype;
  v_group record;
  v_warehouse uuid;
  v_movement uuid;
  v_count int:=0;
begin
  select * into v_inv from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Faktura nie należy do firmy.'; end if;

  delete from public.stock_movement_lines where movement_id in (
    select id from public.stock_movements where workspace_id=p_workspace_id and source_invoice_id=p_invoice_id and status='draft'
  );
  delete from public.stock_movements where workspace_id=p_workspace_id and source_invoice_id=p_invoice_id and status='draft';

  select id into v_warehouse from public.warehouses where workspace_id=p_workspace_id and active=true order by (warehouse_type='central') desc,created_at,id limit 1;
  if v_warehouse is null then
    insert into public.warehouses(workspace_id,name,warehouse_type,active) values(p_workspace_id,'Magazyn główny','central',true) returning id into v_warehouse;
  end if;

  for v_group in
    select fa.allocation_scope,fa.project_id,
      case when fa.allocation_scope='project' then 'direct_project' else 'central_stock' end destination_mode,
      case when fa.allocation_scope='project' then 'project:'||fa.project_id::text else 'inventory' end group_key
    from public.financial_allocations fa
    join public.invoice_lines il on il.id=fa.source_line_id and il.workspace_id=fa.workspace_id
    where fa.workspace_id=p_workspace_id and fa.source_type='invoice' and fa.source_id=p_invoice_id and fa.status='approved'
      and fa.allocation_scope in ('project','inventory')
      and il.line_type='material' and il.stock_item_id is not null and coalesce(il.quantity,0)>0 and fa.amount>0
    group by fa.allocation_scope,fa.project_id
  loop
    insert into public.stock_movements(workspace_id,project_id,warehouse_id,movement_type,document_number,movement_date,status,source_document_id,source_invoice_id,source_group_key,destination_mode)
    values(p_workspace_id,v_group.project_id,v_warehouse,'PZ','PZ-AI-'||upper(substr(p_invoice_id::text,1,8))||'-'||upper(substr(md5(v_group.group_key),1,4)),coalesce(v_inv.issue_date,current_date),'draft',v_inv.document_id,p_invoice_id,v_group.group_key,v_group.destination_mode)
    returning id into v_movement;
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,boq_item_id,quantity,unit_cost,source_invoice_line_id,purchase_order_line_id,procurement_trace_id)
    select il.workspace_id,v_movement,il.stock_item_id,fa.boq_item_id,
      case when il.net_amount=0 then il.quantity else round(il.quantity*(fa.amount/il.net_amount),6) end,
      il.unit_price,il.id,
      (select pol.id from public.purchase_order_lines pol where pol.workspace_id=p_workspace_id and pol.procurement_trace_id=il.procurement_trace_id and (pol.stock_item_id=il.stock_item_id or pol.stock_item_id is null) order by pol.created_at desc limit 1),
      il.procurement_trace_id
    from public.invoice_lines il join public.financial_allocations fa on fa.source_line_id=il.id and fa.workspace_id=il.workspace_id
    where il.invoice_id=p_invoice_id and il.line_type='material' and il.stock_item_id is not null and coalesce(il.quantity,0)>0
      and fa.status='approved' and fa.allocation_scope=v_group.allocation_scope and fa.project_id is not distinct from v_group.project_id and fa.amount>0;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.rebuild_invoice_draft_pz_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rebuild_invoice_draft_pz_atomic(uuid,uuid) to service_role;

create or replace function public.trg_rebuild_pz_after_inbox_processed()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='processed' and new.invoice_id is not null and (old.status is distinct from new.status or old.invoice_id is distinct from new.invoice_id) then
    perform public.rebuild_invoice_draft_pz_atomic(new.workspace_id,new.invoice_id);
  end if;
  return new;
end;
$$;
drop trigger if exists business_inbox_rebuild_pz on public.business_inbox_items;
create trigger business_inbox_rebuild_pz
after update on public.business_inbox_items
for each row execute function public.trg_rebuild_pz_after_inbox_processed();

create or replace function public.process_business_inbox_item_atomic(p_workspace_id uuid,p_inbox_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item public.business_inbox_items%rowtype; v_business jsonb; v_result jsonb; v_invoice uuid; v_has_business boolean;
begin
  select * into v_item from public.business_inbox_items where id=p_inbox_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Element Business Inbox nie należy do firmy.'; end if;
  v_business:=case when jsonb_typeof(v_item.canonical_payload)='object' and v_item.canonical_payload<>'{}'::jsonb then v_item.canonical_payload when jsonb_typeof(v_item.payload->'businessDocument')='object' then v_item.payload->'businessDocument' else v_item.payload end;
  v_has_business:=jsonb_typeof(v_business)='object' and v_business<>'{}'::jsonb and (
    nullif(trim(coalesce(v_business->>'documentNumber',v_business->>'invoiceNumber',v_business->>'ksefNumber','')),'') is not null
    or jsonb_array_length(case when jsonb_typeof(v_business->'lines')='array' then v_business->'lines' else '[]'::jsonb end)>0
    or public.octopus_numeric(v_business->>'grossAmount') is not null
    or public.octopus_numeric(v_business->>'netAmount') is not null
  );
  if not v_has_business then
    update public.business_inbox_items set status='new',processing_error=null,processed_at=null where id=v_item.id;
    return jsonb_build_object('ok',true,'status','new','pending',true,'message','Element oczekuje na pełny kanoniczny dokument biznesowy.');
  end if;
  begin
    v_result:=public.upsert_canonical_business_document_atomic(p_workspace_id,v_item.document_id,v_item.invoice_id,v_item.project_id,v_business,p_actor_id,v_item.source_channel,v_item.external_key);
    v_invoice:=public.octopus_uuid(v_result->>'invoiceId');
    update public.business_inbox_items set invoice_id=coalesce(v_invoice,invoice_id),canonical_payload=v_business,canonical_version='business-document-v1',status=case when coalesce((v_result->>'skipped')::boolean,false) then 'review' else 'processed' end,processing_error=null,processed_at=now() where id=v_item.id;
    return jsonb_build_object('ok',true,'status','processed','result',v_result);
  exception when others then
    update public.business_inbox_items set canonical_payload=v_business,canonical_version='business-document-v1',status='error',processing_error=sqlerrm,processed_at=now() where id=v_item.id;
    return jsonb_build_object('ok',false,'status','error','error',sqlerrm);
  end;
end;$$;
revoke all on function public.process_business_inbox_item_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.process_business_inbox_item_atomic(uuid,uuid,uuid) to service_role;

create or replace function public.create_stock_movement_atomic(p_workspace_id uuid,p_project_id uuid,p_warehouse_id uuid,p_target_warehouse_id uuid,p_stock_item_id uuid,p_movement_type text,p_quantity numeric,p_unit_cost numeric,p_document_number text,p_movement_date date,p_actor_id uuid)
returns table(result_movement_id uuid,available_before numeric,available_after numeric)
language plpgsql security definer set search_path=public as $$
declare v_type text:=upper(trim(coalesce(p_movement_type,'')));v_available numeric:=0;v_after numeric:=0;v_movement_id uuid;v_destination text;
begin
 if v_type not in('PZ','WZ','RW','ZW','MM') then raise exception 'Nieobsługiwany typ ruchu magazynowego: %.',v_type;end if;
 if p_quantity is null or p_quantity<=0 then raise exception 'Ilość ruchu magazynowego musi być większa od zera.';end if;
 if p_unit_cost is not null and p_unit_cost<0 then raise exception 'Koszt jednostkowy nie może być ujemny.';end if;
 perform 1 from public.warehouses where id=p_warehouse_id and workspace_id=p_workspace_id for update;if not found then raise exception 'Magazyn źródłowy nie należy do aktywnej firmy.';end if;
 perform 1 from public.stock_items where id=p_stock_item_id and workspace_id=p_workspace_id for update;if not found then raise exception 'Kartoteka nie należy do aktywnej firmy.';end if;
 if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;if not found then raise exception 'Inwestycja ruchu nie należy do aktywnej firmy.';end if;end if;
 if v_type='MM' then if p_target_warehouse_id is null then raise exception 'MM wymaga magazynu docelowego.';end if;if p_target_warehouse_id=p_warehouse_id then raise exception 'Magazyn źródłowy i docelowy muszą być różne.';end if;perform 1 from public.warehouses where id=p_target_warehouse_id and workspace_id=p_workspace_id for update;if not found then raise exception 'Magazyn docelowy nie należy do aktywnej firmy.';end if;elsif p_target_warehouse_id is not null then raise exception 'Magazyn docelowy można wskazać tylko dla MM.';end if;
 select coalesce(b.quantity,0) into v_available from public.get_stock_balances(p_workspace_id)b where b.warehouse_id=p_warehouse_id and b.stock_item_id=p_stock_item_id;v_available:=coalesce(v_available,0);
 if v_type in('WZ','RW','MM') and v_available+0.000001<p_quantity then raise exception 'Brak wystarczającego stanu dla %. Dostępne: %, wymagane: %.',v_type,v_available,p_quantity;end if;
 v_destination:=case when v_type='PZ' and p_project_id is not null then 'direct_project' when v_type='PZ' then 'central_stock' else 'unassigned' end;
 insert into public.stock_movements(workspace_id,project_id,warehouse_id,target_warehouse_id,movement_type,document_number,movement_date,status,approved_by,approved_at,destination_mode) values(p_workspace_id,p_project_id,p_warehouse_id,case when v_type='MM' then p_target_warehouse_id else null end,v_type,coalesce(nullif(trim(p_document_number),''),v_type||'-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')),coalesce(p_movement_date,current_date),'approved',p_actor_id,now(),v_destination) returning id into v_movement_id;
 insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity,unit_cost)values(p_workspace_id,v_movement_id,p_stock_item_id,p_quantity,p_unit_cost);
 v_after:=case when v_type in('PZ','ZW') then v_available+p_quantity when v_type='MM' then v_available-p_quantity else v_available-p_quantity end;
 insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)values(p_workspace_id,p_project_id,p_actor_id,'stock_movement.created_atomic','stock_movement',v_movement_id::text,jsonb_build_object('movement_type',v_type,'destination_mode',v_destination,'warehouse_id',p_warehouse_id,'target_warehouse_id',case when v_type='MM' then p_target_warehouse_id else null end,'stock_item_id',p_stock_item_id,'quantity',p_quantity,'available_before',v_available,'available_after',v_after));return query select v_movement_id,v_available,v_after;
end;$$;
revoke all on function public.create_stock_movement_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,text,date,uuid) from public,anon,authenticated;
grant execute on function public.create_stock_movement_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,text,date,uuid) to service_role;

insert into public.app_schema_versions(version)
values ('20260819_flow_integrity_1_1_pz_rebuild')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
