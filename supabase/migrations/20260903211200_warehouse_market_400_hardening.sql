begin;

-- Magazyn 4.0 — pełne indeksy FK wymagane przez kontrakt produkcyjny.
create index if not exists stock_lots_supplier_fk400_idx on public.stock_lots(supplier_id);
create index if not exists stock_lots_source_line_fk400_idx on public.stock_lots(source_movement_line_id);
create index if not exists warehouse_logistic_units_location_fk400_idx on public.warehouse_logistic_units(location_id);
create index if not exists warehouse_logistic_units_parent_fk400_idx on public.warehouse_logistic_units(parent_id);
create index if not exists warehouse_lu_items_lot_fk400_idx on public.warehouse_logistic_unit_items(lot_id);
create index if not exists warehouse_tasks_stock_item_fk400_idx on public.warehouse_tasks(stock_item_id);
create index if not exists warehouse_tasks_lot_fk400_idx on public.warehouse_tasks(lot_id);
create index if not exists warehouse_tasks_logistic_unit_fk400_idx on public.warehouse_tasks(logistic_unit_id);
create index if not exists warehouse_tasks_source_location_fk400_idx on public.warehouse_tasks(source_location_id);
create index if not exists warehouse_tasks_target_location_fk400_idx on public.warehouse_tasks(target_location_id);
create index if not exists warehouse_tasks_project_fk400_idx on public.warehouse_tasks(project_id);
create index if not exists warehouse_tasks_assignee_fk400_idx on public.warehouse_tasks(assigned_employee_id);
create index if not exists warehouse_tasks_created_by_fk400_idx on public.warehouse_tasks(created_by);
create index if not exists warehouse_crossdock_outbound_fk400_idx on public.warehouse_crossdock_links(outbound_movement_line_id);
create index if not exists warehouse_crossdock_project_fk400_idx on public.warehouse_crossdock_links(project_id);
create index if not exists warehouse_returns_counterparty_fk400_idx on public.warehouse_returns(counterparty_id);
create index if not exists warehouse_returns_project_fk400_idx on public.warehouse_returns(project_id);
create index if not exists warehouse_returns_document_fk400_idx on public.warehouse_returns(source_document_id);
create index if not exists warehouse_returns_created_by_fk400_idx on public.warehouse_returns(created_by);
create index if not exists warehouse_return_lines_lot_fk400_idx on public.warehouse_return_lines(lot_id);
create index if not exists warehouse_forecasts_warehouse_fk400_idx on public.warehouse_forecasts(warehouse_id);
create index if not exists warehouse_ai_recommendations_stock_fk400_idx on public.warehouse_ai_recommendations(stock_item_id);
create index if not exists warehouse_ai_recommendations_warehouse_fk400_idx on public.warehouse_ai_recommendations(warehouse_id);
create index if not exists warehouse_ai_recommendations_project_fk400_idx on public.warehouse_ai_recommendations(project_id);
create index if not exists warehouse_ai_recommendations_resolved_by_fk400_idx on public.warehouse_ai_recommendations(resolved_by);
create index if not exists warehouse_integrations_created_by_fk400_idx on public.warehouse_integrations(created_by);
create index if not exists warehouse_device_events_integration_fk400_idx on public.warehouse_device_events(integration_id);
create index if not exists warehouse_device_events_warehouse_fk400_idx on public.warehouse_device_events(warehouse_id);
create index if not exists warehouse_device_events_location_fk400_idx on public.warehouse_device_events(location_id);
create index if not exists warehouse_device_events_stock_fk400_idx on public.warehouse_device_events(stock_item_id);
create index if not exists warehouse_device_events_logistic_unit_fk400_idx on public.warehouse_device_events(logistic_unit_id);
create index if not exists warehouse_shipments_project_fk400_idx on public.warehouse_shipments(project_id);
create index if not exists warehouse_shipments_counterparty_fk400_idx on public.warehouse_shipments(counterparty_id);
create index if not exists warehouse_shipments_label_document_fk400_idx on public.warehouse_shipments(label_document_id);

-- Poprawka kontraktu zakupowego: istniejący purchase_orders.destination_mode dopuszcza central_stock/direct_project,
-- a purchase_order_lines.total_amount jest NOT NULL. AI nadal tworzy wyłącznie draft wymagający zatwierdzenia.
create or replace function public.prepare_warehouse_autonomous_replenishment_400(
  p_workspace_id uuid,p_stock_item_id uuid,p_project_id uuid,p_counterparty_id uuid,p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  s public.stock_items%rowtype;
  v_on_hand numeric;
  v_on_order numeric;
  v_target numeric;
  v_qty numeric;
  v_po uuid;
  v_number text;
begin
  select * into s from public.stock_items where id=p_stock_item_id and workspace_id=p_workspace_id and active=true;
  if not found then raise exception 'Kartoteka nie należy do firmy.'; end if;
  if p_project_id is not null then
    perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;
    if not found then raise exception 'Inwestycja nie należy do firmy.'; end if;
  end if;
  if p_counterparty_id is not null then
    perform 1 from public.counterparties where id=p_counterparty_id and workspace_id=p_workspace_id;
    if not found then raise exception 'Dostawca nie należy do firmy.'; end if;
  end if;

  select coalesce(sum(case when m.movement_type in('PZ','ZW') and m.status='approved' then l.quantity when m.movement_type in('WZ','RW') and m.status='approved' then -l.quantity else 0 end),0)
  into v_on_hand
  from public.stock_movement_lines l join public.stock_movements m on m.id=l.movement_id
  where l.workspace_id=p_workspace_id and l.stock_item_id=s.id;

  select coalesce(sum(l.quantity),0) into v_on_order
  from public.purchase_order_lines l join public.purchase_orders o on o.id=l.purchase_order_id
  where l.workspace_id=p_workspace_id and l.stock_item_id=s.id and o.status in('draft','submitted','approved','ordered');

  v_target:=coalesce(s.dynamic_max_stock,s.optimal_stock,s.minimum_stock,0);
  v_qty:=greatest(0,v_target-v_on_hand-v_on_order);
  if v_qty<=0 then raise exception 'Brak potrzeby uzupełnienia zapasu po uwzględnieniu stanu i otwartych zamówień.'; end if;

  v_number:='AI-DRAFT-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')||'-'||left(replace(s.id::text,'-',''),6);
  insert into public.purchase_orders(workspace_id,project_id,counterparty_id,order_number,status,ordered_at,currency,total_amount,notes,created_by,destination_mode)
  values(p_workspace_id,p_project_id,p_counterparty_id,v_number,'draft',current_date,'PLN',0,'Szkic utworzony przez Autonomous Replenishment. Wymaga zatwierdzenia człowieka.',p_actor_id,case when p_project_id is null then 'central_stock' else 'direct_project' end)
  returning id into v_po;

  insert into public.purchase_order_lines(workspace_id,purchase_order_id,stock_item_id,description,quantity,unit,unit_price,total_amount)
  values(p_workspace_id,v_po,s.id,s.name,v_qty,s.unit,null,0);

  insert into public.warehouse_ai_recommendations(workspace_id,stock_item_id,project_id,recommendation_type,dedupe_key,title,description,severity,recommended_action,action_payload,status,generated_by)
  values(p_workspace_id,s.id,p_project_id,'autonomous_replenishment','replenishment:'||v_po,'Utworzono szkic zamówienia',format('%s — %s %s. Szkic czeka na zatwierdzenie.',s.name,v_qty,s.unit),'info','open_purchase_order',jsonb_build_object('purchaseOrderId',v_po),'executed','rules_v1');
  return v_po;
end;$$;
revoke all on function public.prepare_warehouse_autonomous_replenishment_400(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_warehouse_autonomous_replenishment_400(uuid,uuid,uuid,uuid,uuid) to service_role;

insert into public.app_schema_versions(version)
values('20260903_warehouse_market_400_hardening')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
