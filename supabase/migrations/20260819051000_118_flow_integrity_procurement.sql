begin;

create or replace function public.ensure_procurement_trace_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_material_request_id uuid,
  p_stock_item_id uuid,
  p_boq_item_id uuid,
  p_wbs_node_id uuid,
  p_counterparty_id uuid,
  p_destination_mode text,
  p_origin text,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_mode text:=coalesce(nullif(trim(p_destination_mode),''),'unassigned');
  v_origin text:=coalesce(nullif(trim(p_origin),''),'planned');
begin
  if v_mode not in ('direct_project','central_stock','unassigned') then raise exception 'Nieobsługiwany tryb przeznaczenia: %.',v_mode; end if;
  if v_origin not in ('planned','emergency','retroactive','import') then raise exception 'Nieobsługiwane źródło śladu: %.',v_origin; end if;
  perform 1 from public.workspaces where id=p_workspace_id; if not found then raise exception 'Firma nie istnieje.'; end if;
  if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do firmy.'; end if; end if;
  if p_material_request_id is not null then
    select procurement_trace_id into v_id from public.material_requests where id=p_material_request_id and project_id=p_project_id for update;
    if not found then raise exception 'Wniosek materiałowy nie należy do inwestycji.'; end if;
  end if;
  if v_id is null then
    insert into public.procurement_traces(workspace_id,project_id,material_request_id,stock_item_id,boq_item_id,wbs_node_id,counterparty_id,destination_mode,origin,status,created_by)
    values(p_workspace_id,p_project_id,p_material_request_id,p_stock_item_id,p_boq_item_id,p_wbs_node_id,p_counterparty_id,v_mode,v_origin,'open',p_actor_id)
    returning id into v_id;
  else
    update public.procurement_traces set
      project_id=coalesce(p_project_id,project_id),
      stock_item_id=coalesce(p_stock_item_id,stock_item_id),
      boq_item_id=coalesce(p_boq_item_id,boq_item_id),
      wbs_node_id=coalesce(p_wbs_node_id,wbs_node_id),
      counterparty_id=coalesce(p_counterparty_id,counterparty_id),
      destination_mode=v_mode,
      origin=case when origin='planned' then v_origin else origin end,
      updated_at=now()
    where id=v_id and workspace_id=p_workspace_id;
  end if;
  if p_material_request_id is not null then update public.material_requests set procurement_trace_id=v_id,updated_at=now() where id=p_material_request_id; end if;
  return v_id;
end;
$$;
revoke all on function public.ensure_procurement_trace_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.ensure_procurement_trace_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid) to service_role;

create or replace function public.save_material_request_v2_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_source_requirement_id uuid,
  p_title text,
  p_manufacturer text,
  p_product_name text,
  p_model text,
  p_proposed_use text,
  p_compliance_summary text,
  p_stock_item_id uuid,
  p_boq_item_id uuid,
  p_wbs_node_id uuid,
  p_request_origin text,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_status public.review_status;
  v_trace uuid;
  v_wbs uuid;
  v_origin text:=coalesce(nullif(trim(p_request_origin),''),'planned');
begin
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  if v_origin not in ('planned','retroactive') then raise exception 'Wniosek może być planowany albo retrospektywny.'; end if;
  if p_source_requirement_id is not null then perform 1 from public.project_requirements where id=p_source_requirement_id and project_id=p_project_id and requirement_type='material_application'; if not found then raise exception 'Wymaganie materiałowe nie należy do inwestycji.'; end if; end if;
  if p_stock_item_id is not null then perform 1 from public.stock_items where id=p_stock_item_id and workspace_id=p_workspace_id; if not found then raise exception 'Kartoteka materiałowa nie należy do firmy.'; end if; end if;
  if p_boq_item_id is not null then select wbs_node_id into v_wbs from public.boq_items where id=p_boq_item_id and project_id=p_project_id; if not found then raise exception 'Pozycja BOQ nie należy do inwestycji.'; end if; end if;
  if p_wbs_node_id is not null then perform 1 from public.wbs_nodes where id=p_wbs_node_id and project_id=p_project_id; if not found then raise exception 'WBS nie należy do inwestycji.'; end if; end if;
  if nullif(trim(p_title),'') is null then raise exception 'Tytuł wniosku jest wymagany.'; end if;
  if p_request_id is null and p_source_requirement_id is not null then
    select id,status,procurement_trace_id into v_id,v_status,v_trace from public.material_requests where project_id=p_project_id and (source_requirement_id=p_source_requirement_id or generated_source_key='requirement:'||p_source_requirement_id::text) order by created_at desc limit 1 for update;
  end if;
  if p_request_id is not null then select id,status,procurement_trace_id into v_id,v_status,v_trace from public.material_requests where id=p_request_id and project_id=p_project_id for update; if not found then raise exception 'Wniosek nie należy do inwestycji.'; end if; end if;
  if v_id is null then
    insert into public.material_requests(project_id,source_requirement_id,title,manufacturer,product_name,model,proposed_use,compliance_summary,status,created_by,payload,generated_source_key,stock_item_id,boq_item_id,wbs_node_id,request_origin)
    values(p_project_id,p_source_requirement_id,trim(p_title),nullif(trim(p_manufacturer),''),nullif(trim(p_product_name),''),nullif(trim(p_model),''),nullif(trim(p_proposed_use),''),nullif(trim(p_compliance_summary),''),'draft',p_actor_id,jsonb_build_object('source','material_request_workflow_v2'),case when p_source_requirement_id is null then null else 'requirement:'||p_source_requirement_id::text end,p_stock_item_id,p_boq_item_id,coalesce(p_wbs_node_id,v_wbs),v_origin)
    returning id into v_id;
  else
    if v_status not in('draft','ai_ready','in_review','rejected') then raise exception 'Wniosku nie można edytować w statusie %.',v_status; end if;
    update public.material_requests set source_requirement_id=coalesce(p_source_requirement_id,source_requirement_id),title=trim(p_title),manufacturer=nullif(trim(p_manufacturer),''),product_name=nullif(trim(p_product_name),''),model=nullif(trim(p_model),''),proposed_use=nullif(trim(p_proposed_use),''),compliance_summary=nullif(trim(p_compliance_summary),''),stock_item_id=p_stock_item_id,boq_item_id=p_boq_item_id,wbs_node_id=coalesce(p_wbs_node_id,v_wbs),request_origin=v_origin,status=case when v_status='rejected' then 'draft'::public.review_status else v_status end,decision_at=case when v_status='rejected' then null else decision_at end,decision_note=case when v_status='rejected' then null else decision_note end,updated_at=now() where id=v_id;
  end if;
  v_trace:=public.ensure_procurement_trace_atomic(p_workspace_id,p_project_id,v_id,p_stock_item_id,p_boq_item_id,coalesce(p_wbs_node_id,v_wbs),null,'unassigned',case when v_origin='retroactive' then 'retroactive' else 'planned' end,p_actor_id);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,p_project_id,p_actor_id,'material_request.saved_v2_atomic','material_request',v_id::text,jsonb_build_object('source_requirement_id',p_source_requirement_id,'stock_item_id',p_stock_item_id,'boq_item_id',p_boq_item_id,'wbs_node_id',coalesce(p_wbs_node_id,v_wbs),'procurement_trace_id',v_trace,'request_origin',v_origin));
  return v_id;
end;
$$;
revoke all on function public.save_material_request_v2_atomic(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.save_material_request_v2_atomic(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,uuid,uuid,text,uuid) to service_role;

create or replace function public.set_invoice_line_scope_atomic(
  p_workspace_id uuid,
  p_invoice_line_id uuid,
  p_scope text,
  p_project_id uuid,
  p_boq_item_id uuid,
  p_wbs_node_id uuid,
  p_cost_code text,
  p_amount numeric,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_line public.invoice_lines%rowtype;
  v_scope text:=lower(trim(coalesce(p_scope,'')));
  v_id uuid;
  v_other numeric:=0;
  v_wbs uuid;
begin
  select * into v_line from public.invoice_lines where id=p_invoice_line_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Pozycja faktury nie należy do firmy.'; end if;
  if v_scope not in ('project','overhead','unassigned','inventory') then raise exception 'Nieobsługiwany zakres kosztu: %.',v_scope; end if;
  if p_amount is null or p_amount<0 then raise exception 'Kwota alokacji nie może być ujemna.'; end if;
  if v_scope='project' then
    if p_project_id is null then raise exception 'Koszt inwestycyjny wymaga inwestycji.'; end if;
    perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do firmy.'; end if;
    if p_boq_item_id is not null then select wbs_node_id into v_wbs from public.boq_items where id=p_boq_item_id and project_id=p_project_id; if not found then raise exception 'BOQ nie należy do inwestycji.'; end if; end if;
    if p_wbs_node_id is not null then perform 1 from public.wbs_nodes where id=p_wbs_node_id and project_id=p_project_id; if not found then raise exception 'WBS nie należy do inwestycji.'; end if; end if;
    select id into v_id from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=p_invoice_line_id and project_id=p_project_id and allocation_scope='project' and status in ('proposed','approved') order by created_at limit 1 for update;
  else
    if p_project_id is not null then raise exception 'Zakres % nie może mieć project_id.',v_scope; end if;
    select id into v_id from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=p_invoice_line_id and project_id is null and allocation_scope=v_scope and status in ('proposed','approved') order by created_at limit 1 for update;
  end if;
  select coalesce(sum(amount),0) into v_other from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=p_invoice_line_id and status in ('proposed','approved') and (v_id is null or id<>v_id);
  if v_other+p_amount>v_line.net_amount+0.01 then raise exception 'Suma alokacji przekracza netto pozycji. Netto: %, pozostałe: %, nowa: %.',v_line.net_amount,v_other,p_amount; end if;
  if v_id is null then
    insert into public.financial_allocations(workspace_id,project_id,source_type,source_id,source_line_id,boq_item_id,wbs_node_id,cost_code,amount,allocation_percent,status,allocation_basis,allocation_scope)
    values(p_workspace_id,case when v_scope='project' then p_project_id else null end,'invoice',v_line.invoice_id,v_line.id,case when v_scope='project' then p_boq_item_id else null end,case when v_scope='project' then coalesce(p_wbs_node_id,v_wbs) else null end,nullif(trim(coalesce(p_cost_code,'')),''),round(p_amount,2),case when v_line.net_amount=0 then 0 else round(100*p_amount/v_line.net_amount,4) end,'approved','net',v_scope)
    returning id into v_id;
  else
    update public.financial_allocations set project_id=case when v_scope='project' then p_project_id else null end,boq_item_id=case when v_scope='project' then p_boq_item_id else null end,wbs_node_id=case when v_scope='project' then coalesce(p_wbs_node_id,v_wbs) else null end,cost_code=nullif(trim(coalesce(p_cost_code,'')),''),amount=round(p_amount,2),allocation_percent=case when v_line.net_amount=0 then 0 else round(100*p_amount/v_line.net_amount,4) end,status='approved',allocation_basis='net',allocation_scope=v_scope where id=v_id;
  end if;
  perform public.create_accounting_proposal_for_invoice_atomic(p_workspace_id,v_line.invoice_id,p_actor_id);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,case when v_scope='project' then p_project_id else null end,p_actor_id,'invoice_line.scope_allocated','financial_allocation',v_id::text,jsonb_build_object('invoice_line_id',p_invoice_line_id,'scope',v_scope,'amount_net',p_amount,'boq_item_id',p_boq_item_id,'wbs_node_id',coalesce(p_wbs_node_id,v_wbs)));
  return v_id;
end;
$$;
revoke all on function public.set_invoice_line_scope_atomic(uuid,uuid,text,uuid,uuid,uuid,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.set_invoice_line_scope_atomic(uuid,uuid,text,uuid,uuid,uuid,text,numeric,uuid) to service_role;

create or replace function public.set_invoice_line_allocation_atomic(p_workspace_id uuid,p_invoice_line_id uuid,p_project_id uuid,p_boq_item_id uuid,p_wbs_node_id uuid,p_cost_code text,p_amount numeric,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  return public.set_invoice_line_scope_atomic(p_workspace_id,p_invoice_line_id,'project',p_project_id,p_boq_item_id,p_wbs_node_id,p_cost_code,p_amount,p_actor_id);
end;$$;
revoke all on function public.set_invoice_line_allocation_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.set_invoice_line_allocation_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,uuid) to service_role;

create or replace function public.create_purchase_order_v2_atomic(
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
  p_destination_mode text,
  p_actor_id uuid
) returns table(result_order_id uuid,result_line_id uuid,total_amount numeric,procurement_trace_id uuid)
language plpgsql security definer set search_path=public as $$
declare
  v_order uuid; v_line uuid; v_wbs uuid; v_total numeric; v_status public.review_status; v_emergency boolean:=false; v_trace uuid; v_mode text:=lower(trim(coalesce(p_destination_mode,'direct_project'))); v_req record;
begin
  if v_mode not in ('direct_project','central_stock') then raise exception 'Zamówienie musi być bezpośrednio na inwestycję albo na magazyn centralny.'; end if;
  if nullif(trim(p_order_number),'') is null or nullif(trim(p_description),'') is null then raise exception 'Numer i opis zamówienia są wymagane.'; end if;
  if coalesce(p_quantity,0)<=0 or coalesce(p_unit_price,0)<0 then raise exception 'Nieprawidłowa ilość albo cena.'; end if;
  if p_ordered_at is not null and p_expected_at is not null and p_ordered_at>p_expected_at then raise exception 'Termin dostawy nie może poprzedzać zamówienia.'; end if;
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do firmy.'; end if;
  if p_counterparty_id is not null then perform 1 from public.counterparties where id=p_counterparty_id and workspace_id=p_workspace_id; if not found then raise exception 'Dostawca nie należy do firmy.'; end if; end if;
  if p_stock_item_id is not null then perform 1 from public.stock_items where id=p_stock_item_id and workspace_id=p_workspace_id; if not found then raise exception 'Kartoteka nie należy do firmy.'; end if; end if;
  if p_boq_item_id is not null then select wbs_node_id into v_wbs from public.boq_items where id=p_boq_item_id and project_id=p_project_id; if not found then raise exception 'BOQ nie należy do inwestycji.'; end if; end if;
  if p_source_request_id is not null then
    select status,stock_item_id,boq_item_id,wbs_node_id,procurement_trace_id,request_origin into v_req from public.material_requests where id=p_source_request_id and project_id=p_project_id for update;
    if not found then raise exception 'WM nie należy do inwestycji.'; end if;
    v_status:=v_req.status; if v_status<>'approved' then raise exception 'Normalne zamówienie może powstać dopiero z zatwierdzonego WM. Status: %.',v_status; end if;
    if v_req.stock_item_id is not null and p_stock_item_id is distinct from v_req.stock_item_id then raise exception 'Kartoteka zamówienia różni się od materiału zatwierdzonego w WM.'; end if;
    if v_req.boq_item_id is not null and p_boq_item_id is distinct from v_req.boq_item_id then raise exception 'BOQ zamówienia różni się od BOQ zatwierdzonego w WM.'; end if;
    v_trace:=public.ensure_procurement_trace_atomic(p_workspace_id,p_project_id,p_source_request_id,coalesce(p_stock_item_id,v_req.stock_item_id),coalesce(p_boq_item_id,v_req.boq_item_id),coalesce(v_wbs,v_req.wbs_node_id),p_counterparty_id,v_mode,case when v_req.request_origin='retroactive' then 'retroactive' else 'planned' end,p_actor_id);
  else
    v_emergency:=true;
    v_trace:=public.ensure_procurement_trace_atomic(p_workspace_id,p_project_id,null,p_stock_item_id,p_boq_item_id,v_wbs,p_counterparty_id,v_mode,'emergency',p_actor_id);
  end if;
  v_total:=round(p_quantity*coalesce(p_unit_price,0),2);
  insert into public.purchase_orders(workspace_id,project_id,counterparty_id,source_request_id,order_number,status,ordered_at,expected_at,currency,total_amount,created_by,emergency_override,procurement_trace_id,destination_mode)
  values(p_workspace_id,p_project_id,p_counterparty_id,p_source_request_id,trim(p_order_number),'ordered',coalesce(p_ordered_at,current_date),p_expected_at,'PLN',v_total,p_actor_id,v_emergency,v_trace,v_mode) returning id into v_order;
  insert into public.purchase_order_lines(workspace_id,purchase_order_id,stock_item_id,boq_item_id,wbs_node_id,description,quantity,unit,unit_price,total_amount,procurement_trace_id)
  values(p_workspace_id,v_order,p_stock_item_id,p_boq_item_id,v_wbs,trim(p_description),p_quantity,nullif(trim(coalesce(p_unit,'')),''),p_unit_price,v_total,v_trace) returning id into v_line;
  insert into public.material_chain_events(workspace_id,project_id,wbs_node_id,boq_item_id,stock_item_id,procurement_trace_id,stage,source_type,source_id,quantity,unit,amount,status,created_by)
  values(p_workspace_id,p_project_id,v_wbs,p_boq_item_id,p_stock_item_id,v_trace,'ordered','purchase_order_line',v_line,p_quantity,p_unit,v_total,'confirmed',p_actor_id)
  on conflict(workspace_id,stage,source_type,source_id) do update set quantity=excluded.quantity,amount=excluded.amount,status='confirmed',procurement_trace_id=excluded.procurement_trace_id;
  insert into public.commitments(workspace_id,project_id,counterparty_id,source_type,source_id,description,amount,original_amount,recognized_amount,currency,expected_date,status,procurement_trace_id,purchase_order_line_id)
  values(p_workspace_id,case when v_mode='direct_project' then p_project_id else null end,p_counterparty_id,'purchase_order',v_order,'Zamówienie '||trim(p_order_number)||' · '||trim(p_description),v_total,v_total,0,'PLN',p_expected_at,'open',v_trace,v_line);
  if p_stock_item_id is not null and p_unit_price is not null and p_unit_price>0 then
    insert into public.price_observations(workspace_id,project_id,stock_item_id,counterparty_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency,procurement_trace_id,price_stage,canonical_purchase)
    values(p_workspace_id,p_project_id,p_stock_item_id,p_counterparty_id,'purchase_order_line',v_line,coalesce(p_ordered_at,current_date),p_quantity,p_unit,p_unit_price,'PLN',v_trace,'ordered',false)
    on conflict(workspace_id,source_type,source_id) do update set project_id=excluded.project_id,stock_item_id=excluded.stock_item_id,counterparty_id=excluded.counterparty_id,observed_at=excluded.observed_at,quantity=excluded.quantity,unit=excluded.unit,unit_price_net=excluded.unit_price_net,procurement_trace_id=excluded.procurement_trace_id,price_stage='ordered';
  end if;
  update public.procurement_traces set status='ordered',counterparty_id=coalesce(p_counterparty_id,counterparty_id),destination_mode=v_mode,updated_at=now() where id=v_trace;
  if v_emergency then
    insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by)
    values(p_workspace_id,p_project_id,'order_without_approved_wm','warning','purchase_order',v_order,'Zamówienie bez zatwierdzonego WM','Zakup awaryjny utworzony bez źródłowego, zatwierdzonego wniosku materiałowego.',p_actor_id)
    on conflict(workspace_id,deviation_type,source_type,source_id) do nothing;
    update public.purchase_orders set deviation_id=(select id from public.process_deviations where workspace_id=p_workspace_id and source_type='purchase_order' and source_id=v_order and deviation_type='order_without_approved_wm') where id=v_order;
  end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,p_project_id,p_actor_id,'purchase_order.created_v2_atomic','purchase_order',v_order::text,jsonb_build_object('line_id',v_line,'trace_id',v_trace,'destination_mode',v_mode,'approved_wm',not v_emergency,'total_net',v_total));
  return query select v_order,v_line,v_total,v_trace;
end;
$$;
revoke all on function public.create_purchase_order_v2_atomic(uuid,uuid,uuid,uuid,text,date,date,text,uuid,uuid,numeric,text,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.create_purchase_order_v2_atomic(uuid,uuid,uuid,uuid,text,date,date,text,uuid,uuid,numeric,text,numeric,text,uuid) to service_role;

create or replace function public.create_purchase_order_atomic(p_workspace_id uuid,p_project_id uuid,p_counterparty_id uuid,p_source_request_id uuid,p_order_number text,p_ordered_at date,p_expected_at date,p_description text,p_stock_item_id uuid,p_boq_item_id uuid,p_quantity numeric,p_unit text,p_unit_price numeric,p_actor_id uuid)
returns table(result_order_id uuid,result_line_id uuid,total_amount numeric)
language sql security definer set search_path=public as $$
  select result_order_id,result_line_id,total_amount from public.create_purchase_order_v2_atomic(p_workspace_id,p_project_id,p_counterparty_id,p_source_request_id,p_order_number,p_ordered_at,p_expected_at,p_description,p_stock_item_id,p_boq_item_id,p_quantity,p_unit,p_unit_price,'direct_project',p_actor_id);
$$;
revoke all on function public.create_purchase_order_atomic(uuid,uuid,uuid,uuid,text,date,date,text,uuid,uuid,numeric,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.create_purchase_order_atomic(uuid,uuid,uuid,uuid,text,date,date,text,uuid,uuid,numeric,text,numeric,uuid) to service_role;

create or replace function public.sync_purchase_order_commitment_atomic(p_workspace_id uuid,p_purchase_order_id uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_original numeric:=0; v_recognized numeric:=0; v_remaining numeric:=0; v_trace uuid;
begin
  select total_amount,procurement_trace_id into v_original,v_trace from public.purchase_orders where id=p_purchase_order_id and workspace_id=p_workspace_id; if not found then raise exception 'Zamówienie nie należy do firmy.'; end if;
  select coalesce(sum(il.net_amount),0) into v_recognized
  from public.procurement_matches pm
  join public.invoice_lines il on il.id=pm.invoice_line_id
  join public.purchase_order_lines pol on pol.id=pm.purchase_order_line_id
  where pm.workspace_id=p_workspace_id and pol.purchase_order_id=p_purchase_order_id and pm.status in ('matched','approved');
  v_remaining:=greatest(round(v_original-v_recognized,2),0);
  update public.commitments set original_amount=v_original,recognized_amount=round(v_recognized,2),amount=v_remaining,status=case when v_remaining<=0.01 then 'closed' else 'open' end where workspace_id=p_workspace_id and source_type='purchase_order' and source_id=p_purchase_order_id;
  if v_trace is not null and v_remaining<=0.01 then update public.procurement_traces set status='closed',updated_at=now() where id=v_trace; end if;
  return v_remaining;
end;
$$;
revoke all on function public.sync_purchase_order_commitment_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sync_purchase_order_commitment_atomic(uuid,uuid) to service_role;

create or replace function public.set_stock_movement_destination_atomic(p_workspace_id uuid,p_movement_id uuid,p_destination_mode text,p_project_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_m public.stock_movements%rowtype; v_mode text:=lower(trim(coalesce(p_destination_mode,''))); v_line record; v_invoice_line public.invoice_lines%rowtype;
begin
  if v_mode not in ('direct_project','central_stock','unassigned') then raise exception 'Nieobsługiwane przeznaczenie PZ.'; end if;
  select * into v_m from public.stock_movements where id=p_movement_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Ruch nie należy do firmy.'; end if;
  if upper(v_m.movement_type)<>'PZ' or v_m.status<>'draft' then raise exception 'Przeznaczenie można zmienić tylko dla szkicu PZ.'; end if;
  if v_mode='direct_project' then if p_project_id is null then raise exception 'Dostawa bezpośrednia wymaga inwestycji.'; end if; perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id; if not found then raise exception 'Inwestycja nie należy do firmy.'; end if; else p_project_id:=null; end if;
  update public.stock_movements set destination_mode=v_mode,project_id=p_project_id where id=p_movement_id;
  for v_line in select * from public.stock_movement_lines where movement_id=p_movement_id and source_invoice_line_id is not null loop
    select * into v_invoice_line from public.invoice_lines where id=v_line.source_invoice_line_id;
    if found then
      delete from public.financial_allocations where workspace_id=p_workspace_id and source_type='invoice' and source_line_id=v_invoice_line.id and status in ('proposed','approved') and ((v_mode='direct_project' and (allocation_scope<>'project' or project_id is distinct from p_project_id)) or (v_mode<>'direct_project' and allocation_scope<>case when v_mode='central_stock' then 'inventory' else 'unassigned' end));
      perform public.set_invoice_line_scope_atomic(p_workspace_id,v_invoice_line.id,case when v_mode='direct_project' then 'project' when v_mode='central_stock' then 'inventory' else 'unassigned' end,p_project_id,null,null,null,v_invoice_line.net_amount,p_actor_id);
    end if;
  end loop;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,p_project_id,p_actor_id,'stock_movement.destination_set','stock_movement',p_movement_id::text,jsonb_build_object('destination_mode',v_mode));
  return p_movement_id;
end;
$$;
revoke all on function public.set_stock_movement_destination_atomic(uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_stock_movement_destination_atomic(uuid,uuid,text,uuid,uuid) to service_role;

insert into public.app_schema_versions(version) values ('20260819_flow_integrity_1_1_procurement') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
