begin;

create or replace function public.consume_inventory_for_issue_atomic(p_issue_line_id uuid)
returns numeric
language plpgsql
security definer
set search_path=public
as $$
declare
  v_line public.stock_movement_lines%rowtype;
  v_m public.stock_movements%rowtype;
  v_layer record;
  v_need numeric;
  v_take numeric;
  v_cost numeric:=0;
  v_fallback_cost numeric:=0;
  v_warehouse_type text;
  v_recognize boolean;
begin
  select * into v_line from public.stock_movement_lines where id=p_issue_line_id for update;
  if not found then raise exception 'Pozycja wydania nie istnieje.'; end if;
  select * into v_m from public.stock_movements where id=v_line.movement_id;
  if not found or v_m.status<>'approved' or upper(v_m.movement_type)<>'RW' or v_m.project_id is null then return 0; end if;
  if exists(select 1 from public.inventory_consumptions where issue_line_id=v_line.id) then
    select coalesce(sum(amount) filter(where recognize_project_cost),0) into v_cost from public.inventory_consumptions where issue_line_id=v_line.id;
    return v_cost;
  end if;
  select warehouse_type into v_warehouse_type from public.warehouses where id=v_m.warehouse_id;
  v_need:=v_line.quantity;
  for v_layer in
    select * from public.inventory_cost_layers
    where workspace_id=v_m.workspace_id and warehouse_id=v_m.warehouse_id and stock_item_id=v_line.stock_item_id and remaining_quantity>0
    order by received_at,id
    for update
  loop
    exit when v_need<=0.000001;
    v_take:=least(v_need,v_layer.remaining_quantity);
    v_recognize:=v_layer.recognition_mode in ('central_stock','unassigned');
    insert into public.inventory_consumptions(workspace_id,project_id,issue_line_id,cost_layer_id,procurement_trace_id,quantity,unit_cost,amount,recognize_project_cost,source_recognition_mode)
    values(v_m.workspace_id,v_m.project_id,v_line.id,v_layer.id,v_layer.procurement_trace_id,v_take,v_layer.unit_cost,round(v_take*v_layer.unit_cost,2),v_recognize,v_layer.recognition_mode);
    update public.inventory_cost_layers set remaining_quantity=greatest(remaining_quantity-v_take,0) where id=v_layer.id;
    if v_recognize then v_cost:=v_cost+round(v_take*v_layer.unit_cost,2); end if;
    v_need:=v_need-v_take;
  end loop;
  if v_need>0.000001 then
    v_fallback_cost:=coalesce(v_line.unit_cost,(select unit_cost from public.inventory_cost_layers where workspace_id=v_m.workspace_id and stock_item_id=v_line.stock_item_id order by received_at desc limit 1),0);
    v_recognize:=coalesce(v_warehouse_type,'')='central';
    insert into public.inventory_consumptions(workspace_id,project_id,issue_line_id,cost_layer_id,procurement_trace_id,quantity,unit_cost,amount,recognize_project_cost,source_recognition_mode)
    values(v_m.workspace_id,v_m.project_id,v_line.id,null,v_line.procurement_trace_id,v_need,v_fallback_cost,round(v_need*v_fallback_cost,2),v_recognize,'legacy');
    if v_recognize then v_cost:=v_cost+round(v_need*v_fallback_cost,2); end if;
  end if;
  return round(v_cost,2);
end;
$$;
revoke all on function public.consume_inventory_for_issue_atomic(uuid) from public,anon,authenticated;
grant execute on function public.consume_inventory_for_issue_atomic(uuid) to service_role;

create or replace function public.sync_material_chain_for_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_m public.stock_movements%rowtype;
  v_l record;
  v_stage text;
  v_trace uuid;
  v_amount numeric;
  v_invoice uuid;
begin
  select * into v_m from public.stock_movements where id=p_movement_id;
  if not found or v_m.status<>'approved' then return; end if;
  v_stage:=case upper(v_m.movement_type) when 'PZ' then 'received' when 'RW' then 'issued' when 'WZ' then 'issued' when 'ZW' then 'returned' when 'MM' then 'transferred' else lower(v_m.movement_type) end;
  for v_l in select * from public.stock_movement_lines where movement_id=v_m.id loop
    v_trace:=coalesce(v_l.procurement_trace_id,v_m.procurement_trace_id);
    if v_trace is null and v_l.purchase_order_line_id is not null then select procurement_trace_id into v_trace from public.purchase_order_lines where id=v_l.purchase_order_line_id; end if;
    if v_trace is not null and v_l.procurement_trace_id is null then update public.stock_movement_lines set procurement_trace_id=v_trace where id=v_l.id; end if;
    if upper(v_m.movement_type)='PZ' then
      v_amount:=case when v_l.unit_cost is null then null else round(v_l.quantity*v_l.unit_cost,2) end;
      if v_l.unit_cost is not null and v_l.unit_cost>=0 then
        insert into public.inventory_cost_layers(workspace_id,warehouse_id,stock_item_id,procurement_trace_id,source_receipt_line_id,recognition_mode,owner_project_id,original_quantity,remaining_quantity,unit_cost,received_at)
        values(v_m.workspace_id,v_m.warehouse_id,v_l.stock_item_id,v_trace,v_l.id,v_m.destination_mode,case when v_m.destination_mode='direct_project' then v_m.project_id else null end,v_l.quantity,v_l.quantity,v_l.unit_cost,coalesce(v_m.approved_at,v_m.created_at))
        on conflict(source_receipt_line_id) do nothing;
      end if;
      if v_l.unit_cost is not null and v_l.unit_cost>0 then
        insert into public.price_observations(workspace_id,project_id,stock_item_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency,procurement_trace_id,price_stage,canonical_purchase)
        select v_m.workspace_id,v_m.project_id,v_l.stock_item_id,'stock_movement_line',v_l.id,v_m.movement_date,v_l.quantity,si.unit,v_l.unit_cost,'PLN',v_trace,'received',false from public.stock_items si where si.id=v_l.stock_item_id
        on conflict(workspace_id,source_type,source_id) do update set project_id=excluded.project_id,stock_item_id=excluded.stock_item_id,observed_at=excluded.observed_at,quantity=excluded.quantity,unit=excluded.unit,unit_price_net=excluded.unit_price_net,procurement_trace_id=excluded.procurement_trace_id,price_stage='received';
      end if;
      if v_trace is not null then update public.procurement_traces set status=case when status='closed' then status else 'received' end,updated_at=now() where id=v_trace; end if;
    elsif upper(v_m.movement_type)='RW' then
      perform public.consume_inventory_for_issue_atomic(v_l.id);
      select coalesce(sum(amount),case when v_l.unit_cost is null then null else round(v_l.quantity*v_l.unit_cost,2) end) into v_amount from public.inventory_consumptions where issue_line_id=v_l.id;
    else
      v_amount:=case when v_l.unit_cost is null then null else round(v_l.quantity*v_l.unit_cost,2) end;
    end if;
    insert into public.material_chain_events(workspace_id,project_id,boq_item_id,stock_item_id,procurement_trace_id,stage,source_type,source_id,quantity,unit,amount,status,created_by,occurred_at)
    select v_m.workspace_id,v_m.project_id,v_l.boq_item_id,v_l.stock_item_id,v_trace,v_stage,'stock_movement_line',v_l.id,v_l.quantity,si.unit,v_amount,'confirmed',v_m.approved_by,coalesce(v_m.approved_at,v_m.created_at) from public.stock_items si where si.id=v_l.stock_item_id
    on conflict(workspace_id,stage,source_type,source_id) do update set project_id=excluded.project_id,boq_item_id=excluded.boq_item_id,stock_item_id=excluded.stock_item_id,procurement_trace_id=excluded.procurement_trace_id,quantity=excluded.quantity,unit=excluded.unit,amount=excluded.amount,status='confirmed',occurred_at=excluded.occurred_at;
    if v_l.source_invoice_line_id is not null then
      select invoice_id into v_invoice from public.invoice_lines where id=v_l.source_invoice_line_id;
      if v_invoice is not null then perform public.refresh_procurement_matches_for_invoice_atomic(v_m.workspace_id,v_invoice,coalesce(v_m.approved_by,(select created_by from public.projects where id=v_m.project_id))); end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.sync_material_chain_for_movement(uuid) from public,anon,authenticated;
grant execute on function public.sync_material_chain_for_movement(uuid) to service_role;

create or replace function public.protect_approved_stock_movement_line()
returns trigger language plpgsql set search_path=public as $$
declare v_status text;
begin
  select status into v_status from public.stock_movements where id=case when tg_op='DELETE' then old.movement_id else new.movement_id end;
  if v_status='approved' then raise exception 'Zatwierdzonego ruchu magazynowego nie można edytować. Użyj ruchu korygującego.'; end if;
  return case when tg_op='DELETE' then old else new end;
end;$$;
drop trigger if exists stock_movement_lines_approved_freeze on public.stock_movement_lines;
create trigger stock_movement_lines_approved_freeze before update or delete on public.stock_movement_lines for each row execute function public.protect_approved_stock_movement_line();

create or replace function public.approve_stock_movement_atomic(p_workspace_id uuid,p_movement_id uuid,p_actor_id uuid)
returns uuid
language plpgsql security definer set search_path=public as $$
declare v_m public.stock_movements%rowtype; v_type text; v_line record; v_available numeric; v_count int:=0;
begin
  select * into v_m from public.stock_movements where id=p_movement_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Ruch magazynowy nie należy do firmy.'; end if;
  if v_m.status<>'draft' then raise exception 'Tylko szkic można zatwierdzić.'; end if;
  v_type:=upper(trim(v_m.movement_type)); if v_type not in('PZ','WZ','RW','ZW','MM') then raise exception 'Nieobsługiwany typ ruchu: %.',v_type; end if;
  if v_type='PZ' and v_m.destination_mode='unassigned' then raise exception 'Przed zatwierdzeniem PZ określ: inwestycja bezpośrednia albo magazyn centralny.'; end if;
  if v_type='PZ' and v_m.destination_mode='direct_project' and v_m.project_id is null then raise exception 'PZ bezpośrednie wymaga inwestycji.'; end if;
  for v_line in select stock_item_id,sum(quantity)::numeric quantity from public.stock_movement_lines where workspace_id=p_workspace_id and movement_id=p_movement_id group by stock_item_id order by stock_item_id loop
    v_count:=v_count+1; if v_line.quantity<=0 then raise exception 'Ilość musi być większa od zera.'; end if;
    if v_type in('WZ','RW','MM') then select coalesce(quantity,0) into v_available from public.get_stock_balances(p_workspace_id) where warehouse_id=v_m.warehouse_id and stock_item_id=v_line.stock_item_id; if coalesce(v_available,0)+0.000001<v_line.quantity then raise exception 'Brak stanu magazynowego. Dostępne: %, wymagane: %.',coalesce(v_available,0),v_line.quantity; end if; end if;
  end loop;
  if v_count=0 then raise exception 'Nie można zatwierdzić ruchu bez pozycji.'; end if;
  update public.stock_movements set status='approved',approved_by=p_actor_id,approved_at=now() where id=p_movement_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,v_m.project_id,p_actor_id,'stock_movement.approved_flow_integrity','stock_movement',p_movement_id::text,jsonb_build_object('movement_type',v_type,'destination_mode',v_m.destination_mode,'lines',v_count));
  return p_movement_id;
end;
$$;
revoke all on function public.approve_stock_movement_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_stock_movement_atomic(uuid,uuid,uuid) to service_role;

create or replace function public.refresh_procurement_matches_for_invoice_atomic(p_workspace_id uuid,p_invoice_id uuid,p_actor_id uuid)
returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_inv public.invoices%rowtype; v_line public.invoice_lines%rowtype; v_project uuid; v_scope text; v_trace uuid; v_po record; v_candidate_count int; v_receipt_id uuid; v_received numeric; v_status text; v_warn jsonb; v_qty_var numeric; v_price_var numeric; v_count int:=0; v_order_id uuid;
begin
  select * into v_inv from public.invoices where id=p_invoice_id and workspace_id=p_workspace_id; if not found then raise exception 'Faktura nie należy do firmy.'; end if;
  for v_line in select * from public.invoice_lines where invoice_id=p_invoice_id order by line_number loop
    if coalesce(v_line.line_type,'other')<>'material' then
      delete from public.procurement_matches where workspace_id=p_workspace_id and invoice_line_id=v_line.id;
      update public.process_deviations set status='closed',closed_by=p_actor_id,closed_at=now(),resolution_note='Pozycja nie jest materiałem — 3-way match nie ma zastosowania.' where workspace_id=p_workspace_id and source_type='invoice_line' and source_id=v_line.id and deviation_type in('purchase_without_po','invoice_without_receipt','quantity_variance','price_variance') and status='open';
      continue;
    end if;
    select fa.project_id,fa.allocation_scope into v_project,v_scope from public.financial_allocations fa where fa.workspace_id=p_workspace_id and fa.source_type='invoice' and fa.source_line_id=v_line.id and fa.status='approved' order by fa.amount desc limit 1;
    v_trace:=v_line.procurement_trace_id; v_po:=null; v_candidate_count:=0; v_order_id:=null;
    if v_trace is not null then
      select pol.*,po.project_id order_project_id,po.id order_id into v_po from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where pol.workspace_id=p_workspace_id and pol.procurement_trace_id=v_trace and po.status not in('cancelled','rejected') order by pol.created_at desc limit 1;
    end if;
    if v_po.id is null and nullif(v_line.business_metadata->>'purchaseOrderNumber','') is not null then
      select pol.*,po.project_id order_project_id,po.id order_id into v_po from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where pol.workspace_id=p_workspace_id and po.order_number=v_line.business_metadata->>'purchaseOrderNumber' and po.status not in('cancelled','rejected') and ((v_line.stock_item_id is not null and pol.stock_item_id=v_line.stock_item_id) or public.normalize_material_key(pol.description)=public.normalize_material_key(v_line.description)) order by pol.created_at desc limit 1;
    end if;
    if v_po.id is null and v_project is not null then
      select count(*) into v_candidate_count from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where pol.workspace_id=p_workspace_id and po.project_id=v_project and po.status not in('cancelled','rejected') and (v_inv.counterparty_id is null or po.counterparty_id=v_inv.counterparty_id) and ((v_line.stock_item_id is not null and pol.stock_item_id=v_line.stock_item_id) or (v_line.stock_item_id is null and public.normalize_material_key(pol.description)=public.normalize_material_key(v_line.description))) and abs(coalesce(po.ordered_at,v_inv.issue_date)-coalesce(v_inv.issue_date,po.ordered_at))<=60;
      if v_candidate_count=1 then select pol.*,po.project_id order_project_id,po.id order_id into v_po from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where pol.workspace_id=p_workspace_id and po.project_id=v_project and po.status not in('cancelled','rejected') and (v_inv.counterparty_id is null or po.counterparty_id=v_inv.counterparty_id) and ((v_line.stock_item_id is not null and pol.stock_item_id=v_line.stock_item_id) or (v_line.stock_item_id is null and public.normalize_material_key(pol.description)=public.normalize_material_key(v_line.description))) and abs(coalesce(po.ordered_at,v_inv.issue_date)-coalesce(v_inv.issue_date,po.ordered_at))<=60 limit 1; end if;
    end if;
    if v_po.id is not null then
      v_order_id:=v_po.order_id; v_project:=coalesce(v_project,v_po.order_project_id); v_trace:=coalesce(v_trace,v_po.procurement_trace_id);
      if v_trace is not null and v_line.procurement_trace_id is null then update public.invoice_lines set procurement_trace_id=v_trace where id=v_line.id; end if;
    end if;
    v_receipt_id:=null; v_received:=0;
    if v_po.id is not null then
      select min(sml.id),coalesce(sum(sml.quantity),0) into v_receipt_id,v_received from public.stock_movement_lines sml join public.stock_movements sm on sm.id=sml.movement_id where sml.workspace_id=p_workspace_id and sm.status='approved' and upper(sm.movement_type)='PZ' and (sml.purchase_order_line_id=v_po.id or (v_trace is not null and sml.procurement_trace_id=v_trace) or sml.source_invoice_line_id=v_line.id);
      if v_receipt_id is not null then update public.stock_movement_lines set purchase_order_line_id=coalesce(purchase_order_line_id,v_po.id),procurement_trace_id=coalesce(procurement_trace_id,v_trace) where id=v_receipt_id; end if;
    elsif v_trace is not null then
      select min(sml.id),coalesce(sum(sml.quantity),0) into v_receipt_id,v_received from public.stock_movement_lines sml join public.stock_movements sm on sm.id=sml.movement_id where sml.workspace_id=p_workspace_id and sm.status='approved' and upper(sm.movement_type)='PZ' and sml.procurement_trace_id=v_trace;
    end if;
    v_qty_var:=coalesce(v_line.quantity,0)-coalesce(v_received,0);
    v_price_var:=case when coalesce(v_po.unit_price,0)=0 then null else round(100*(coalesce(v_line.unit_price,0)-v_po.unit_price)/v_po.unit_price,4) end;
    v_warn:='[]'::jsonb;
    if coalesce(v_scope,'unassigned')='unassigned' then v_warn:=v_warn||jsonb_build_array('Pozycja kosztowa nadal jest nierozpoznana.'); end if;
    if v_po.id is null then v_warn:=v_warn||jsonb_build_array('Brak twardego powiązania z PO.'); end if;
    if v_receipt_id is null then v_warn:=v_warn||jsonb_build_array('Brak zatwierdzonego PZ.'); end if;
    if v_receipt_id is not null and abs(v_qty_var)>0.0001 then v_warn:=v_warn||jsonb_build_array('Różnica ilości faktura ↔ PZ.'); end if;
    if v_po.id is not null and v_price_var is not null and abs(v_price_var)>2 then v_warn:=v_warn||jsonb_build_array('Cena faktury różni się od PO o ponad 2%.'); end if;
    v_status:=case when v_po.id is not null and v_receipt_id is not null and abs(v_qty_var)<=0.0001 and coalesce(abs(v_price_var),0)<=2 then 'matched' else 'review' end;
    insert into public.procurement_matches(workspace_id,project_id,invoice_line_id,purchase_order_line_id,receipt_line_id,ordered_quantity,received_quantity,invoiced_quantity,ordered_unit_price,invoiced_unit_price,quantity_variance,price_variance_percent,status,warnings,created_by,updated_at)
    values(p_workspace_id,v_project,v_line.id,v_po.id,v_receipt_id,v_po.quantity,v_received,v_line.quantity,v_po.unit_price,v_line.unit_price,v_qty_var,v_price_var,v_status,v_warn,p_actor_id,now())
    on conflict(workspace_id,invoice_line_id) do update set project_id=excluded.project_id,purchase_order_line_id=excluded.purchase_order_line_id,receipt_line_id=excluded.receipt_line_id,ordered_quantity=excluded.ordered_quantity,received_quantity=excluded.received_quantity,invoiced_quantity=excluded.invoiced_quantity,ordered_unit_price=excluded.ordered_unit_price,invoiced_unit_price=excluded.invoiced_unit_price,quantity_variance=excluded.quantity_variance,price_variance_percent=excluded.price_variance_percent,status=case when public.procurement_matches.status='approved' and excluded.status='matched' then 'approved' else excluded.status end,warnings=excluded.warnings,updated_at=now();
    if v_trace is not null then
      update public.price_observations set procurement_trace_id=v_trace where workspace_id=p_workspace_id and source_type='invoice_line' and source_id=v_line.id;
      update public.procurement_traces set status=case when status='closed' then status else 'invoiced' end,updated_at=now() where id=v_trace;
    end if;
    if v_project is not null and v_po.id is null then insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by) values(p_workspace_id,v_project,'purchase_without_po','warning','invoice_line',v_line.id,'Zakup bez twardego PO','Nie znaleziono jednoznacznego PO/WM. Automatyczne dopasowanie nie zostało wymuszone.',p_actor_id) on conflict(workspace_id,deviation_type,source_type,source_id) do update set status='open',closed_at=null,closed_by=null,resolution_note=null,detail=excluded.detail; end if;
    if v_project is not null and v_receipt_id is null then insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by) values(p_workspace_id,v_project,'invoice_without_receipt','warning','invoice_line',v_line.id,'Faktura bez potwierdzonego PZ','Materiał z faktury nie ma zatwierdzonego przyjęcia.',p_actor_id) on conflict(workspace_id,deviation_type,source_type,source_id) do update set status='open',closed_at=null,closed_by=null,resolution_note=null,detail=excluded.detail; end if;
    if v_project is not null and v_receipt_id is not null and abs(v_qty_var)>0.0001 then insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by) values(p_workspace_id,v_project,'quantity_variance','warning','invoice_line',v_line.id,'Różnica ilości faktura ↔ PZ','Różnica ilości: '||v_qty_var::text||' '||coalesce(v_line.unit,''),p_actor_id) on conflict(workspace_id,deviation_type,source_type,source_id) do update set status='open',closed_at=null,closed_by=null,resolution_note=null,detail=excluded.detail; end if;
    if v_project is not null and v_po.id is not null and v_price_var is not null and abs(v_price_var)>2 then insert into public.process_deviations(workspace_id,project_id,deviation_type,severity,source_type,source_id,title,detail,created_by) values(p_workspace_id,v_project,'price_variance','warning','invoice_line',v_line.id,'Różnica ceny faktura ↔ PO','Odchylenie ceny: '||v_price_var::text||'%.',p_actor_id) on conflict(workspace_id,deviation_type,source_type,source_id) do update set status='open',closed_at=null,closed_by=null,resolution_note=null,detail=excluded.detail; end if;
    if v_status='matched' then update public.process_deviations set status='closed',closed_by=p_actor_id,closed_at=now(),resolution_note='Automatycznie zamknięte po poprawnym twardym 3-way match.' where workspace_id=p_workspace_id and source_type='invoice_line' and source_id=v_line.id and deviation_type in('purchase_without_po','invoice_without_receipt','quantity_variance','price_variance') and status='open'; end if;
    if v_order_id is not null then perform public.sync_purchase_order_commitment_atomic(p_workspace_id,v_order_id); end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.refresh_procurement_matches_for_invoice_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.refresh_procurement_matches_for_invoice_atomic(uuid,uuid,uuid) to service_role;

create or replace function public.approve_procurement_match_atomic(p_workspace_id uuid,p_match_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_project uuid; v_line uuid; v_po_line uuid; v_order uuid;
begin
  select project_id,invoice_line_id,purchase_order_line_id into v_project,v_line,v_po_line from public.procurement_matches where id=p_match_id and workspace_id=p_workspace_id for update; if not found then raise exception 'Uzgodnienie nie należy do firmy.'; end if;
  if v_po_line is null then raise exception 'Nie można zatwierdzić 3-way match bez wskazanego PO.'; end if;
  update public.procurement_matches set status='approved',approved_by=p_actor_id,approved_at=now(),updated_at=now() where id=p_match_id;
  select purchase_order_id into v_order from public.purchase_order_lines where id=v_po_line;
  if v_order is not null then perform public.sync_purchase_order_commitment_atomic(p_workspace_id,v_order); end if;
  update public.process_deviations set status='closed',closed_by=p_actor_id,closed_at=now(),resolution_note='Uzgodniono ręcznie w 3-way match.' where workspace_id=p_workspace_id and source_type='invoice_line' and source_id=v_line and status='open';
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id) values(p_workspace_id,v_project,p_actor_id,'procurement.match_approved','procurement_match',p_match_id::text);
  return p_match_id;
end;
$$;
revoke all on function public.approve_procurement_match_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_procurement_match_atomic(uuid,uuid,uuid) to service_role;

create or replace function public.get_price_intelligence(p_workspace_id uuid,p_project_id uuid default null,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path=public as $$
with ranked as (
  select po.*,
    coalesce(po.procurement_trace_id::text,po.source_type||':'||po.source_id::text) purchase_key,
    row_number() over(partition by coalesce(po.procurement_trace_id::text,po.source_type||':'||po.source_id::text) order by case po.price_stage when 'invoiced' then 1 when 'received' then 2 when 'ordered' then 3 else 4 end,po.observed_at desc,po.created_at desc) rn
  from public.price_observations po
  where po.workspace_id=p_workspace_id and (p_project_id is null or po.project_id=p_project_id)
), purchases as (
  select r.*,si.name stock_name,si.sku,c.name supplier_name
  from ranked r join public.stock_items si on si.id=r.stock_item_id left join public.counterparties c on c.id=r.counterparty_id
  where r.rn=1
), history as (
  select p.*,
    lag(p.unit_price_net) over(partition by p.stock_item_id order by p.observed_at,p.created_at) previous_price,
    avg(p.unit_price_net) over(partition by p.stock_item_id order by p.observed_at rows between 5 preceding and 1 preceding) previous_avg
  from purchases p
), limited as (
  select * from history order by observed_at desc,created_at desc limit greatest(1,least(coalesce(p_limit,50),200))
), stage_prices as (
  select procurement_trace_id,
    max(unit_price_net) filter(where price_stage='ordered') ordered_price,
    max(unit_price_net) filter(where price_stage='received') received_price,
    max(unit_price_net) filter(where price_stage='invoiced') invoiced_price
  from public.price_observations where workspace_id=p_workspace_id and procurement_trace_id is not null group by procurement_trace_id
)
select jsonb_build_object('observations',coalesce(jsonb_agg(jsonb_build_object(
  'stockItemId',l.stock_item_id,'stockName',l.stock_name,'sku',l.sku,'supplier',l.supplier_name,'date',l.observed_at,
  'unitPriceNet',l.unit_price_net,'quantity',l.quantity,'unit',l.unit,'previousPrice',l.previous_price,'previousAverage',l.previous_avg,
  'changePercent',case when coalesce(l.previous_price,0)=0 then null else round(100*(l.unit_price_net-l.previous_price)/l.previous_price,2) end,
  'procurementTraceId',l.procurement_trace_id,'canonicalStage',l.price_stage,'orderedPrice',sp.ordered_price,'receivedPrice',sp.received_price,'invoicedPrice',sp.invoiced_price,
  'sourceType',l.source_type,'sourceId',l.source_id
) order by l.observed_at desc),'[]'::jsonb)) from limited l left join stage_prices sp on sp.procurement_trace_id=l.procurement_trace_id;
$$;
revoke all on function public.get_price_intelligence(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.get_price_intelligence(uuid,uuid,integer) to service_role;

insert into public.app_schema_versions(version) values ('20260819_flow_integrity_1_1_matching_inventory') on conflict(version) do update set applied_at=excluded.applied_at;
commit;
