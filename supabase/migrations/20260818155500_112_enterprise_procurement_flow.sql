begin;

alter table public.invoice_lines add column if not exists line_type text not null default 'other';
alter table public.invoice_lines drop constraint if exists invoice_lines_line_type_check;
alter table public.invoice_lines add constraint invoice_lines_line_type_check check(line_type in('material','service','other'));
do $$ begin
  if not exists(select 1 from pg_constraint where conname='purchase_orders_deviation_id_fkey' and conrelid='public.purchase_orders'::regclass) then
    alter table public.purchase_orders add constraint purchase_orders_deviation_id_fkey foreign key(deviation_id) references public.process_deviations(id) on delete set null;
  end if;
end $$;

create or replace function public.create_purchase_order_atomic(
  p_workspace_id uuid,p_project_id uuid,p_counterparty_id uuid,p_source_request_id uuid,p_order_number text,
  p_ordered_at date,p_expected_at date,p_description text,p_stock_item_id uuid,p_boq_item_id uuid,p_quantity numeric,
  p_unit text,p_unit_price numeric,p_actor_id uuid
)
returns table(result_order_id uuid,result_line_id uuid,total_amount numeric)
language plpgsql security definer set search_path=public as $$
declare v_order_id uuid;v_line_id uuid;v_wbs_id uuid;v_total numeric;v_request_status public.review_status;v_emergency boolean:=false;
begin
  if nullif(trim(p_order_number),'') is null then raise exception 'Numer zamówienia jest wymagany.'; end if;
  if nullif(trim(p_description),'') is null then raise exception 'Opis pozycji zamówienia jest wymagany.'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'Ilość zamówienia musi być większa od zera.'; end if;
  if coalesce(p_unit_price,0)<0 then raise exception 'Cena jednostkowa nie może być ujemna.'; end if;
  if p_ordered_at is not null and p_expected_at is not null and p_ordered_at>p_expected_at then raise exception 'Termin dostawy nie może poprzedzać daty zamówienia.'; end if;
  perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.';end if;
  if p_counterparty_id is not null then perform 1 from public.counterparties where id=p_counterparty_id and workspace_id=p_workspace_id;if not found then raise exception 'Dostawca nie należy do aktywnej firmy.';end if;end if;
  if p_source_request_id is not null then
    select status into v_request_status from public.material_requests where id=p_source_request_id and project_id=p_project_id for update;
    if not found then raise exception 'Wniosek materiałowy nie należy do inwestycji.';end if;
    if v_request_status<>'approved' then raise exception 'Normalne zamówienie może powstać dopiero z zatwierdzonego WM. Aktualny status: %.',v_request_status;end if;
  else v_emergency:=true;end if;
  if p_stock_item_id is not null then perform 1 from public.stock_items where id=p_stock_item_id and workspace_id=p_workspace_id;if not found then raise exception 'Kartoteka magazynowa nie należy do firmy.';end if;end if;
  if p_boq_item_id is not null then select wbs_node_id into v_wbs_id from public.boq_items where id=p_boq_item_id and project_id=p_project_id;if not found then raise exception 'Pozycja BOQ nie należy do inwestycji.';end if;end if;
  v_total:=round(coalesce(p_quantity,0)*coalesce(p_unit_price,0),2);
  insert into public.purchase_orders(workspace_id,project_id,counterparty_id,source_request_id,order_number,status,ordered_at,expected_at,currency,total_amount,created_by,emergency_override)
  values(p_workspace_id,p_project_id,p_counterparty_id,p_source_request_id,trim(p_order_number),'ordered',coalesce(p_ordered_at,current_date),p_expected_at,'PLN',v_total,p_actor_id,v_emergency) returning id into v_order_id;
  insert into public.purchase_order_lines(workspace_id,purchase_order_id,stock_item_id,boq_item_id,wbs_node_id,description,quantity,unit,unit_price,total_amount)
  values(p_workspace_id,v_order_id,p_stock_item_id,p_boq_item_id,v_wbs_id,trim(p_description),p_quantity,nullif(trim(coalesce(p_unit,'')),''),p_unit_price,v_total) returning id into v_line_id;
  if p_boq_item_id is not null then
    insert into public.entity_links(workspace_id,source_type,source_id,target_type,target_id,relation_type,confidence,status,created_by,approved_by,approved_at)
    values(p_workspace_id,'purchase_order_line',v_line_id,'boq_item',p_boq_item_id,'material_trace',1,'approved',p_actor_id,p_actor_id,now())
    on conflict(workspace_id,source_type,source_id,target_type,target_id,relation_type) do nothing;
  end if;
  insert into public.material_chain_events(workspace_id,project_id,wbs_node_id,boq_item_id,stock_item_id,stage,source_type,source_id,quantity,unit,amount,status,created_by)
  values(p_workspace_id,p_project_id,v_wbs_id,p_boq_item_id,p_stock_item_id,'ordered','purchase_order_line',v_line_id,p_quantity,p_unit,v_total,'confirmed',p_actor_id)
  on conflict(workspace_id,stage,source_type,source_id) do update set quantity=excluded.quantity,amount=excluded.amount,status='confirmed';
  insert into public.commitments(workspace_id,project_id,counterparty_id,source_type,source_id,description,amount,currency,expected_date,status)
  values(p_workspace_id,p_project_id,p_counterparty_id,'purchase_order',v_order_id,'Zamówienie '||trim(p_order_number)||' · '||trim(p_description),v_total,'PLN',p_expected_at,'open');
  if p_stock_item_id is not null and p_unit_price is not null and p_unit_price>0 then
    insert into public.price_observations(workspace_id,project_id,stock_item_id,counterparty_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency)
    values(p_workspace_id,p_project_id,p_stock_item_id,p_counterparty_id,'purchase_order_line',v_line_id,coalesce(p_ordered_at,current_date),p_quantity,p_unit,p_unit_price,'PLN')
    on conflict(workspace_id,source_type,source_id) do update set unit_price_net=excluded.unit_price_net,quantity=excluded.quantity,observed_at=excluded.observed_at,counterparty_id=excluded.counterparty_id;
  end if;
  if v_emergency then
    insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by)
    values(p_workspace_id,p_project_id,'order_without_approved_wm','warning','purchase_order',v_order_id,'Zamówienie bez zatwierdzonego WM','Zamówienie utworzono bez źródłowego, zatwierdzonego wniosku materiałowego. Wymaga uzasadnienia/akceptacji odstępstwa.',p_actor_id)
    on conflict(workspace_id,deviation_type,source_type,source_id) do nothing;
    update public.purchase_orders set deviation_id=(select id from public.process_deviations where workspace_id=p_workspace_id and source_type='purchase_order' and source_id=v_order_id and deviation_type='order_without_approved_wm') where id=v_order_id;
  end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'purchase_order.created_atomic','purchase_order',v_order_id::text,jsonb_build_object('line_id',v_line_id,'source_request_id',p_source_request_id,'approved_wm',not v_emergency,'emergency_override',v_emergency,'boq_item_id',p_boq_item_id,'stock_item_id',p_stock_item_id,'total_net',v_total));
  return query select v_order_id,v_line_id,v_total;
end;
$$;

create or replace function public.sync_material_chain_for_movement(p_movement_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_m public.stock_movements%rowtype;v_l record;v_stage text;
begin
  select * into v_m from public.stock_movements where id=p_movement_id;
  if not found or v_m.status<>'approved' then return;end if;
  v_stage:=case upper(v_m.movement_type) when 'PZ' then 'received' when 'RW' then 'issued' when 'WZ' then 'issued' when 'ZW' then 'returned' when 'MM' then 'transferred' else lower(v_m.movement_type) end;
  for v_l in select * from public.stock_movement_lines where movement_id=v_m.id loop
    insert into public.material_chain_events(workspace_id,project_id,boq_item_id,stock_item_id,stage,source_type,source_id,quantity,unit,amount,status,created_by,occurred_at)
    select v_m.workspace_id,v_m.project_id,v_l.boq_item_id,v_l.stock_item_id,v_stage,'stock_movement_line',v_l.id,v_l.quantity,si.unit,case when v_l.unit_cost is null then null else round(v_l.quantity*v_l.unit_cost,2) end,'confirmed',v_m.approved_by,coalesce(v_m.approved_at,v_m.created_at)
    from public.stock_items si where si.id=v_l.stock_item_id
    on conflict(workspace_id,stage,source_type,source_id) do update set project_id=excluded.project_id,boq_item_id=excluded.boq_item_id,stock_item_id=excluded.stock_item_id,quantity=excluded.quantity,unit=excluded.unit,amount=excluded.amount,status='confirmed',occurred_at=excluded.occurred_at;
    if upper(v_m.movement_type)='PZ' and v_l.unit_cost is not null and v_l.unit_cost>0 then
      insert into public.price_observations(workspace_id,project_id,stock_item_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency)
      select v_m.workspace_id,v_m.project_id,v_l.stock_item_id,'stock_movement_line',v_l.id,v_m.movement_date,v_l.quantity,si.unit,v_l.unit_cost,'PLN' from public.stock_items si where si.id=v_l.stock_item_id
      on conflict(workspace_id,source_type,source_id) do update set project_id=excluded.project_id,stock_item_id=excluded.stock_item_id,observed_at=excluded.observed_at,quantity=excluded.quantity,unit=excluded.unit,unit_price_net=excluded.unit_price_net;
    end if;
  end loop;
end;
$$;
create or replace function public.trg_sync_material_chain_movement() returns trigger language plpgsql security definer set search_path=public as $$begin perform public.sync_material_chain_for_movement(new.id);return new;end;$$;
create or replace function public.trg_sync_material_chain_line() returns trigger language plpgsql security definer set search_path=public as $$begin perform public.sync_material_chain_for_movement(new.movement_id);return new;end;$$;
drop trigger if exists sync_material_chain_on_movement on public.stock_movements;
create trigger sync_material_chain_on_movement after insert or update of status,approved_at on public.stock_movements for each row when(new.status='approved') execute function public.trg_sync_material_chain_movement();
drop trigger if exists sync_material_chain_on_line on public.stock_movement_lines;
create trigger sync_material_chain_on_line after insert or update of quantity,unit_cost,boq_item_id on public.stock_movement_lines for each row execute function public.trg_sync_material_chain_line();

create or replace function public.refresh_procurement_matches_for_invoice_atomic(p_workspace_id uuid,p_invoice_id uuid,p_actor_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_inv public.invoices%rowtype;v_line public.invoice_lines%rowtype;v_project uuid;v_po record;v_receipt record;v_status text;v_warn jsonb;v_qty_var numeric;v_price_var numeric;v_count int:=0;
begin
  select * into v_inv from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Faktura nie należy do aktywnej firmy.';end if;
  for v_line in select * from public.invoice_lines where invoice_id=p_invoice_id order by line_number loop
    if coalesce(v_line.line_type,'other')<>'material' then
      delete from public.procurement_matches where workspace_id=p_workspace_id and invoice_line_id=v_line.id;
      update public.process_deviations set status='closed',closed_by=p_actor_id,closed_at=now(),resolution_note='Pozycja nie jest materiałem — 3-way match magazynowy nie ma zastosowania.' where workspace_id=p_workspace_id and source_type='invoice_line' and source_id=v_line.id and deviation_type in('purchase_without_po','invoice_without_receipt','quantity_variance','price_variance') and status='open';
      continue;
    end if;
    select fa.project_id into v_project from public.financial_allocations fa where fa.workspace_id=p_workspace_id and fa.source_type='invoice' and fa.source_line_id=v_line.id and fa.status='approved' order by fa.amount desc limit 1;
    v_po:=null;v_receipt:=null;
    if v_project is not null then
      select pol.*,po.counterparty_id,po.ordered_at into v_po from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where pol.workspace_id=p_workspace_id and po.project_id=v_project and po.status not in('cancelled','rejected') and (v_inv.counterparty_id is null or po.counterparty_id=v_inv.counterparty_id) and ((v_line.stock_item_id is not null and pol.stock_item_id=v_line.stock_item_id) or (v_line.stock_item_id is null and public.normalize_material_key(pol.description)=public.normalize_material_key(v_line.description))) order by abs(coalesce(po.ordered_at,v_inv.issue_date)-coalesce(v_inv.issue_date,po.ordered_at)),pol.created_at desc limit 1;
      select sml.*,sm.movement_date into v_receipt from public.stock_movement_lines sml join public.stock_movements sm on sm.id=sml.movement_id where sml.workspace_id=p_workspace_id and sm.project_id=v_project and sm.status='approved' and upper(sm.movement_type)='PZ' and ((v_line.stock_item_id is not null and sml.stock_item_id=v_line.stock_item_id) or sml.source_invoice_line_id=v_line.id) order by abs(sm.movement_date-coalesce(v_inv.issue_date,sm.movement_date)),sm.created_at desc limit 1;
    end if;
    v_qty_var:=coalesce(v_line.quantity,0)-coalesce(v_receipt.quantity,0);
    v_price_var:=case when coalesce(v_po.unit_price,0)=0 then null else round(100*(coalesce(v_line.unit_price,0)-v_po.unit_price)/v_po.unit_price,4) end;
    v_warn:='[]'::jsonb;
    if v_project is null then v_warn:=v_warn||jsonb_build_array('Brak alokacji pozycji do inwestycji.');end if;
    if v_po.id is null then v_warn:=v_warn||jsonb_build_array('Brak powiązanego zamówienia PO.');end if;
    if v_receipt.id is null then v_warn:=v_warn||jsonb_build_array('Brak zatwierdzonego przyjęcia PZ.');end if;
    if v_receipt.id is not null and abs(v_qty_var)>0.0001 then v_warn:=v_warn||jsonb_build_array('Różnica ilości między fakturą i PZ.');end if;
    if v_po.id is not null and v_price_var is not null and abs(v_price_var)>2 then v_warn:=v_warn||jsonb_build_array('Cena faktury różni się od PO o ponad 2%.');end if;
    v_status:=case when v_project is not null and v_po.id is not null and v_receipt.id is not null and abs(v_qty_var)<=0.0001 and coalesce(abs(v_price_var),0)<=2 then 'matched' else 'review' end;
    insert into public.procurement_matches(workspace_id,project_id,invoice_line_id,purchase_order_line_id,receipt_line_id,ordered_quantity,received_quantity,invoiced_quantity,ordered_unit_price,invoiced_unit_price,quantity_variance,price_variance_percent,status,warnings,created_by,updated_at)
    values(p_workspace_id,v_project,v_line.id,v_po.id,v_receipt.id,v_po.quantity,v_receipt.quantity,v_line.quantity,v_po.unit_price,v_line.unit_price,v_qty_var,v_price_var,v_status,v_warn,p_actor_id,now())
    on conflict(workspace_id,invoice_line_id) do update set project_id=excluded.project_id,purchase_order_line_id=excluded.purchase_order_line_id,receipt_line_id=excluded.receipt_line_id,ordered_quantity=excluded.ordered_quantity,received_quantity=excluded.received_quantity,invoiced_quantity=excluded.invoiced_quantity,ordered_unit_price=excluded.ordered_unit_price,invoiced_unit_price=excluded.invoiced_unit_price,quantity_variance=excluded.quantity_variance,price_variance_percent=excluded.price_variance_percent,status=excluded.status,warnings=excluded.warnings,updated_at=now();
    if v_project is not null and v_po.id is null then insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by) values(p_workspace_id,v_project,'purchase_without_po','warning','invoice_line',v_line.id,'Zakup bez powiązanego zamówienia','Pozycja materiałowa faktury nie ma dopasowanego PO/WM.',p_actor_id) on conflict(workspace_id,deviation_type,source_type,source_id) do update set status='open',closed_at=null,closed_by=null,resolution_note=null,detail=excluded.detail;end if;
    if v_project is not null and v_receipt.id is null then insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by) values(p_workspace_id,v_project,'invoice_without_receipt','warning','invoice_line',v_line.id,'Faktura bez potwierdzonego PZ','Materiał z faktury nie ma zatwierdzonego przyjęcia magazynowego.',p_actor_id) on conflict(workspace_id,deviation_type,source_type,source_id) do update set status='open',closed_at=null,closed_by=null,resolution_note=null,detail=excluded.detail;end if;
    if v_project is not null and v_receipt.id is not null and abs(v_qty_var)>0.0001 then insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by) values(p_workspace_id,v_project,'quantity_variance','warning','invoice_line',v_line.id,'Różnica ilości faktura ↔ PZ','Różnica ilości: '||v_qty_var::text||' '||coalesce(v_line.unit,''),p_actor_id) on conflict(workspace_id,deviation_type,source_type,source_id) do update set status='open',closed_at=null,closed_by=null,resolution_note=null,detail=excluded.detail;end if;
    if v_project is not null and v_po.id is not null and v_price_var is not null and abs(v_price_var)>2 then insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by) values(p_workspace_id,v_project,'price_variance','warning','invoice_line',v_line.id,'Różnica ceny faktura ↔ PO','Odchylenie ceny: '||v_price_var::text||'%.',p_actor_id) on conflict(workspace_id,deviation_type,source_type,source_id) do update set status='open',closed_at=null,closed_by=null,resolution_note=null,detail=excluded.detail;end if;
    if v_status='matched' then update public.process_deviations set status='closed',closed_by=p_actor_id,closed_at=now(),resolution_note='Automatycznie zamknięte po poprawnym 3-way match.' where workspace_id=p_workspace_id and source_type='invoice_line' and source_id=v_line.id and deviation_type in('purchase_without_po','invoice_without_receipt','quantity_variance','price_variance') and status='open';end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.approve_procurement_match_atomic(p_workspace_id uuid,p_match_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_project uuid;v_line uuid;
begin
  select project_id,invoice_line_id into v_project,v_line from public.procurement_matches where id=p_match_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Uzgodnienie nie należy do aktywnej firmy.';end if;
  update public.procurement_matches set status='approved',approved_by=p_actor_id,approved_at=now(),updated_at=now() where id=p_match_id;
  update public.process_deviations set status='closed',closed_by=p_actor_id,closed_at=now(),resolution_note='Uzgodniono ręcznie w 3-way match.' where workspace_id=p_workspace_id and source_type='invoice_line' and source_id=v_line and status='open';
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id) values(p_workspace_id,v_project,p_actor_id,'procurement.match_approved','procurement_match',p_match_id::text);
  return p_match_id;
end;
$$;

create or replace function public.get_price_intelligence(p_workspace_id uuid,p_project_id uuid default null,p_limit int default 50)
returns jsonb language sql stable security definer set search_path=public as $$
with rows as (
  select po.*,si.name stock_name,si.sku,c.name supplier_name,
    lag(po.unit_price_net) over(partition by po.stock_item_id order by po.observed_at,po.created_at) previous_price,
    avg(po.unit_price_net) over(partition by po.stock_item_id order by po.observed_at rows between 5 preceding and 1 preceding) previous_avg
  from public.price_observations po join public.stock_items si on si.id=po.stock_item_id left join public.counterparties c on c.id=po.counterparty_id
  where po.workspace_id=p_workspace_id and (p_project_id is null or po.project_id=p_project_id)
), latest as (select * from rows order by observed_at desc,created_at desc limit greatest(1,least(coalesce(p_limit,50),200)))
select jsonb_build_object('observations',coalesce(jsonb_agg(jsonb_build_object('stockItemId',stock_item_id,'stockName',stock_name,'sku',sku,'supplier',supplier_name,'date',observed_at,'unitPriceNet',unit_price_net,'quantity',quantity,'unit',unit,'previousPrice',previous_price,'previousAverage',previous_avg,'changePercent',case when coalesce(previous_price,0)=0 then null else round(100*(unit_price_net-previous_price)/previous_price,2) end,'sourceType',source_type,'sourceId',source_id) order by observed_at desc),'[]'::jsonb)) from latest;
$$;

revoke all on function public.create_purchase_order_atomic(uuid,uuid,uuid,uuid,text,date,date,text,uuid,uuid,numeric,text,numeric,uuid) from public,anon,authenticated;
revoke all on function public.sync_material_chain_for_movement(uuid) from public,anon,authenticated;
revoke all on function public.refresh_procurement_matches_for_invoice_atomic(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.approve_procurement_match_atomic(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_price_intelligence(uuid,uuid,int) from public,anon,authenticated;
grant execute on function public.create_purchase_order_atomic(uuid,uuid,uuid,uuid,text,date,date,text,uuid,uuid,numeric,text,numeric,uuid) to service_role;
grant execute on function public.sync_material_chain_for_movement(uuid) to service_role;
grant execute on function public.refresh_procurement_matches_for_invoice_atomic(uuid,uuid,uuid) to service_role;
grant execute on function public.approve_procurement_match_atomic(uuid,uuid,uuid) to service_role;
grant execute on function public.get_price_intelligence(uuid,uuid,int) to service_role;

insert into public.app_schema_versions(version) values ('20260818_enterprise_procurement_flow') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
