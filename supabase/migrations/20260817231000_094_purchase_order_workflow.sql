begin;

create or replace function public.create_purchase_order_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_counterparty_id uuid,
  p_source_request_id uuid,
  p_order_number text,
  p_ordered_at date,
  p_expected_at date,
  p_description text,
  p_stock_item_id uuid,
  p_boq_item_id uuid,
  p_quantity numeric,
  p_unit text,
  p_unit_price numeric,
  p_actor_id uuid
)
returns table(result_order_id uuid,result_line_id uuid,total_amount numeric)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order_id uuid;
  v_line_id uuid;
  v_wbs_id uuid;
  v_total numeric;
begin
  if nullif(trim(p_order_number),'') is null then raise exception 'Numer zamówienia jest wymagany.'; end if;
  if nullif(trim(p_description),'') is null then raise exception 'Opis pozycji zamówienia jest wymagany.'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'Ilość zamówienia musi być większa od zera.'; end if;
  if coalesce(p_unit_price,0)<0 then raise exception 'Cena jednostkowa nie może być ujemna.'; end if;
  if p_ordered_at is not null and p_expected_at is not null and p_ordered_at>p_expected_at then raise exception 'Termin dostawy nie może poprzedzać daty zamówienia.'; end if;

  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  if p_counterparty_id is not null then
    perform 1 from public.counterparties where id=p_counterparty_id and workspace_id=p_workspace_id;
    if not found then raise exception 'Dostawca nie należy do aktywnej firmy.'; end if;
  end if;
  if p_source_request_id is not null then
    perform 1 from public.material_requests where id=p_source_request_id and project_id=p_project_id;
    if not found then raise exception 'Wniosek materiałowy nie należy do inwestycji.'; end if;
  end if;
  if p_stock_item_id is not null then
    perform 1 from public.stock_items where id=p_stock_item_id and workspace_id=p_workspace_id;
    if not found then raise exception 'Kartoteka magazynowa nie należy do firmy.'; end if;
  end if;
  if p_boq_item_id is not null then
    select wbs_node_id into v_wbs_id from public.boq_items where id=p_boq_item_id and workspace_id=p_workspace_id and project_id=p_project_id;
    if not found then raise exception 'Pozycja BOQ nie należy do inwestycji.'; end if;
  end if;

  v_total:=round(coalesce(p_quantity,0)*coalesce(p_unit_price,0),2);
  insert into public.purchase_orders(workspace_id,project_id,counterparty_id,source_request_id,order_number,status,ordered_at,expected_at,currency,total_amount,created_by)
  values(p_workspace_id,p_project_id,p_counterparty_id,p_source_request_id,trim(p_order_number),'ordered',coalesce(p_ordered_at,current_date),p_expected_at,'PLN',v_total,p_actor_id)
  returning id into v_order_id;

  insert into public.purchase_order_lines(workspace_id,purchase_order_id,stock_item_id,boq_item_id,wbs_node_id,description,quantity,unit,unit_price,total_amount)
  values(p_workspace_id,v_order_id,p_stock_item_id,p_boq_item_id,v_wbs_id,trim(p_description),p_quantity,nullif(trim(coalesce(p_unit,'')),''),p_unit_price,v_total)
  returning id into v_line_id;

  if p_boq_item_id is not null then
    insert into public.entity_links(workspace_id,source_type,source_id,target_type,target_id,relation_type,confidence,status,created_by,approved_by,approved_at)
    values(p_workspace_id,'purchase_order_line',v_line_id,'boq_item',p_boq_item_id,'material_trace',1,'approved',p_actor_id,p_actor_id,now())
    on conflict(workspace_id,source_type,source_id,target_type,target_id,relation_type) do nothing;
  end if;

  insert into public.material_chain_events(workspace_id,project_id,wbs_node_id,boq_item_id,stock_item_id,stage,source_type,source_id,quantity,unit,amount,status,created_by)
  values(p_workspace_id,p_project_id,v_wbs_id,p_boq_item_id,p_stock_item_id,'ordered','purchase_order_line',v_line_id,p_quantity,p_unit,v_total,'confirmed',p_actor_id);

  insert into public.commitments(workspace_id,project_id,counterparty_id,source_type,source_id,description,amount,currency,expected_date,status)
  values(p_workspace_id,p_project_id,p_counterparty_id,'purchase_order',v_order_id,'Zamówienie '||trim(p_order_number)||' · '||trim(p_description),v_total,'PLN',p_expected_at,'open');

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'purchase_order.created_atomic','purchase_order',v_order_id::text,jsonb_build_object('line_id',v_line_id,'source_request_id',p_source_request_id,'boq_item_id',p_boq_item_id,'stock_item_id',p_stock_item_id,'total_amount',v_total));

  return query select v_order_id,v_line_id,v_total;
end;
$$;

revoke all on function public.create_purchase_order_atomic(uuid,uuid,uuid,uuid,text,date,date,text,uuid,uuid,numeric,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.create_purchase_order_atomic(uuid,uuid,uuid,uuid,text,date,date,text,uuid,uuid,numeric,text,numeric,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260817_094_purchase_order_workflow')
on conflict(version) do update set applied_at=excluded.applied_at;
commit;
