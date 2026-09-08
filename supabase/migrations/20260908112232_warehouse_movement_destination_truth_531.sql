alter table public.stock_movements
  add column if not exists counterparty_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_movements'::regclass
      and conname = 'stock_movements_counterparty_id_fkey'
  ) then
    alter table public.stock_movements
      add constraint stock_movements_counterparty_id_fkey
      foreign key (counterparty_id) references public.counterparties(id) on delete set null;
  end if;
end;
$migration$;

create index if not exists stock_movements_counterparty_idx
  on public.stock_movements(workspace_id, counterparty_id)
  where counterparty_id is not null;

update public.stock_movements sm
   set counterparty_id = i.counterparty_id
  from public.invoices i
 where sm.source_invoice_id = i.id
   and sm.workspace_id = i.workspace_id
   and sm.counterparty_id is null
   and i.counterparty_id is not null;

alter table public.stock_movements
  drop constraint if exists stock_movements_destination_mode_check;

alter table public.stock_movements
  add constraint stock_movements_destination_mode_check
  check (destination_mode = any (array['direct_project'::text, 'central_stock'::text, 'external_customer'::text, 'unassigned'::text]));

comment on column public.stock_movements.counterparty_id is
  'Commercial counterparty related to the movement: supplier for inbound PZ, customer/recipient for outbound WZ.';

create or replace function public.set_stock_movement_route_atomic(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_destination_mode text,
  p_project_id uuid,
  p_counterparty_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = 'public','private','pg_temp'
as $function$
declare
  v_m public.stock_movements%rowtype;
  v_mode text := lower(trim(coalesce(p_destination_mode,'')));
  v_type text;
  v_line record;
  v_invoice_line public.invoice_lines%rowtype;
begin
  select * into v_m
    from public.stock_movements
   where id = p_movement_id and workspace_id = p_workspace_id
   for update;
  if not found then raise exception 'Ruch nie należy do firmy.'; end if;
  if v_m.status <> 'draft' then raise exception 'Przeznaczenie można zmienić tylko dla szkicu ruchu.'; end if;

  v_type := upper(trim(v_m.movement_type));

  if v_type = 'PZ' then
    if v_mode not in ('direct_project','central_stock','unassigned') then
      raise exception 'PZ można skierować na zapas centralny albo bezpośrednio na inwestycję.';
    end if;
    if v_mode = 'direct_project' then
      if p_project_id is null then raise exception 'Dostawa bezpośrednia wymaga inwestycji.'; end if;
      perform 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id;
      if not found then raise exception 'Inwestycja nie należy do firmy.'; end if;
    else
      p_project_id := null;
    end if;
    if p_counterparty_id is not null then
      perform 1 from public.counterparties where id = p_counterparty_id and workspace_id = p_workspace_id;
      if not found then raise exception 'Kontrahent nie należy do firmy.'; end if;
    end if;
    update public.stock_movements
       set destination_mode = v_mode,
           project_id = p_project_id,
           counterparty_id = coalesce(p_counterparty_id, v_m.counterparty_id)
     where id = p_movement_id;

    for v_line in
      select * from public.stock_movement_lines
       where movement_id = p_movement_id and source_invoice_line_id is not null
    loop
      select * into v_invoice_line from public.invoice_lines where id = v_line.source_invoice_line_id;
      if found then
        delete from public.financial_allocations
         where workspace_id = p_workspace_id
           and source_type = 'invoice'
           and source_line_id = v_invoice_line.id
           and status in ('proposed','approved')
           and (
             (v_mode = 'direct_project' and (allocation_scope <> 'project' or project_id is distinct from p_project_id))
             or (v_mode <> 'direct_project' and allocation_scope <> case when v_mode = 'central_stock' then 'inventory' else 'unassigned' end)
           );
        perform public.set_invoice_line_scope_atomic(
          p_workspace_id,
          v_invoice_line.id,
          case when v_mode = 'direct_project' then 'project' when v_mode = 'central_stock' then 'inventory' else 'unassigned' end,
          p_project_id,
          null,null,null,
          v_invoice_line.net_amount,
          p_actor_id
        );
      end if;
    end loop;

  elsif v_type = 'WZ' then
    if v_mode not in ('direct_project','external_customer','unassigned') then
      raise exception 'WZ wymaga inwestycji albo klienta zewnętrznego.';
    end if;
    if v_mode = 'direct_project' then
      if p_project_id is null then raise exception 'Wydanie na inwestycję wymaga wskazania inwestycji.'; end if;
      perform 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id;
      if not found then raise exception 'Inwestycja nie należy do firmy.'; end if;
      p_counterparty_id := null;
    elsif v_mode = 'external_customer' then
      if p_counterparty_id is null then raise exception 'Wydanie zewnętrzne wymaga wskazania klienta.'; end if;
      perform 1 from public.counterparties where id = p_counterparty_id and workspace_id = p_workspace_id and active;
      if not found then raise exception 'Klient nie należy do aktywnej firmy.'; end if;
      p_project_id := null;
    else
      p_project_id := null;
      p_counterparty_id := null;
    end if;
    update public.stock_movements
       set destination_mode = v_mode,
           project_id = p_project_id,
           counterparty_id = p_counterparty_id
     where id = p_movement_id;
  else
    raise exception 'Przeznaczenie w tym trybie można zmieniać tylko dla PZ i WZ.';
  end if;

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(
    p_workspace_id,
    p_project_id,
    p_actor_id,
    'stock_movement.route_set',
    'stock_movement',
    p_movement_id::text,
    jsonb_build_object('movement_type',v_type,'destination_mode',v_mode,'counterparty_id',p_counterparty_id)
  );
  return p_movement_id;
end;
$function$;

revoke all on function public.set_stock_movement_route_atomic(uuid,uuid,text,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_stock_movement_route_atomic(uuid,uuid,text,uuid,uuid,uuid) to service_role;

create or replace function public.create_stock_movement_draft_v2_atomic(
  p_workspace_id uuid,
  p_movement_type text,
  p_warehouse_id uuid,
  p_target_warehouse_id uuid,
  p_destination_mode text,
  p_project_id uuid,
  p_counterparty_id uuid,
  p_document_number text,
  p_movement_date date,
  p_lines jsonb,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = 'public','private','pg_temp'
as $function$
declare
  v_type text := upper(btrim(coalesce(p_movement_type,'')));
  v_mode text := lower(btrim(coalesce(p_destination_mode,'')));
  v_id uuid;
  v_line jsonb;
  v_item uuid;
  v_qty numeric;
  v_cost numeric;
  v_count integer := 0;
begin
  if v_type not in ('PZ','WZ','RW','ZW','MM') then raise exception 'Nieobsługiwany typ ruchu.'; end if;
  perform 1 from public.warehouses where id = p_warehouse_id and workspace_id = p_workspace_id and active;
  if not found then raise exception 'Magazyn źródłowy nie należy do aktywnej firmy.'; end if;

  if v_type = 'MM' then
    perform 1 from public.warehouses where id = p_target_warehouse_id and workspace_id = p_workspace_id and active;
    if not found or p_target_warehouse_id = p_warehouse_id then raise exception 'Wskaż inny aktywny magazyn docelowy.'; end if;
  else
    p_target_warehouse_id := null;
  end if;

  if v_mode = '' then
    v_mode := case
      when v_type = 'PZ' and p_project_id is not null then 'direct_project'
      when v_type = 'PZ' then 'central_stock'
      when v_type = 'WZ' and p_project_id is not null then 'direct_project'
      when v_type = 'WZ' and p_counterparty_id is not null then 'external_customer'
      when v_type = 'WZ' then 'unassigned'
      when v_type = 'RW' and p_project_id is not null then 'direct_project'
      when v_type in ('ZW','MM') then 'central_stock'
      else 'unassigned'
    end;
  end if;

  if v_type = 'PZ' then
    if v_mode not in ('central_stock','direct_project') then raise exception 'PZ wymaga zapasu centralnego albo inwestycji.'; end if;
    if v_mode = 'direct_project' and p_project_id is null then raise exception 'PZ bezpośrednie wymaga inwestycji.'; end if;
    if v_mode = 'central_stock' then p_project_id := null; end if;
  elsif v_type = 'WZ' then
    if v_mode not in ('direct_project','external_customer') then raise exception 'WZ wymaga inwestycji albo klienta zewnętrznego.'; end if;
    if v_mode = 'direct_project' then
      if p_project_id is null then raise exception 'Wydanie na inwestycję wymaga inwestycji.'; end if;
      p_counterparty_id := null;
    else
      if p_counterparty_id is null then raise exception 'Wydanie zewnętrzne wymaga klienta.'; end if;
      p_project_id := null;
    end if;
  end if;

  if p_project_id is not null then
    perform 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id;
    if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  end if;
  if p_counterparty_id is not null then
    perform 1 from public.counterparties where id = p_counterparty_id and workspace_id = p_workspace_id and active;
    if not found then raise exception 'Kontrahent nie należy do aktywnej firmy.'; end if;
  end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) <> 'array' then raise exception 'Pozycje ruchu są nieprawidłowe.'; end if;

  insert into public.stock_movements(
    workspace_id,project_id,counterparty_id,warehouse_id,target_warehouse_id,movement_type,
    document_number,movement_date,status,source_group_key,destination_mode
  ) values (
    p_workspace_id,p_project_id,p_counterparty_id,p_warehouse_id,p_target_warehouse_id,v_type,
    nullif(btrim(coalesce(p_document_number,'')),''),coalesce(p_movement_date,current_date),'draft','manual-531',v_mode
  ) returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin v_item := (v_line->>'stockItemId')::uuid; exception when others then v_item := null; end;
    v_qty := private.try_numeric(v_line->>'quantity');
    v_cost := private.try_numeric(v_line->>'unitCost');
    perform 1 from public.stock_items where id = v_item and workspace_id = p_workspace_id and active;
    if not found or coalesce(v_qty,0) <= 0 then continue; end if;
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity,unit_cost)
    values(p_workspace_id,v_id,v_item,v_qty,case when coalesce(v_cost,0) >= 0 then v_cost else null end);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    delete from public.stock_movements where id = v_id;
    raise exception 'Dodaj co najmniej jedną prawidłową pozycję ruchu.';
  end if;

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(
    p_workspace_id,p_project_id,p_actor_id,'warehouse.manual_draft_created_v2','stock_movement',v_id::text,
    jsonb_build_object('movement_type',v_type,'destination_mode',v_mode,'counterparty_id',p_counterparty_id,'lines',v_count)
  );
  return v_id;
end;
$function$;

revoke all on function public.create_stock_movement_draft_v2_atomic(uuid,text,uuid,uuid,text,uuid,uuid,text,date,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.create_stock_movement_draft_v2_atomic(uuid,text,uuid,uuid,text,uuid,uuid,text,date,jsonb,uuid) to service_role;

create or replace function public.approve_stock_movement_atomic(p_workspace_id uuid, p_movement_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public','private','pg_temp'
as $function$
declare
  v_m public.stock_movements%rowtype;
  v_type text;
  v_line record;
  v_available numeric;
  v_count int := 0;
begin
  select * into v_m from public.stock_movements where id = p_movement_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Ruch magazynowy nie należy do firmy.'; end if;
  if v_m.status <> 'draft' then raise exception 'Tylko szkic można zatwierdzić.'; end if;
  v_type := upper(trim(v_m.movement_type));
  if v_type not in ('PZ','WZ','RW','ZW','MM') then raise exception 'Nieobsługiwany typ ruchu: %.', v_type; end if;

  if v_type = 'PZ' and v_m.destination_mode = 'unassigned' then
    raise exception 'Przed zatwierdzeniem PZ określ: inwestycja bezpośrednia albo magazyn centralny.';
  end if;
  if v_type = 'PZ' and v_m.destination_mode = 'direct_project' and v_m.project_id is null then
    raise exception 'PZ bezpośrednie wymaga inwestycji.';
  end if;
  if v_type = 'WZ' and v_m.destination_mode not in ('direct_project','external_customer') then
    raise exception 'Przed zatwierdzeniem WZ wskaż inwestycję albo klienta zewnętrznego.';
  end if;
  if v_type = 'WZ' and v_m.destination_mode = 'direct_project' and v_m.project_id is null then
    raise exception 'WZ na inwestycję wymaga wskazania inwestycji.';
  end if;
  if v_type = 'WZ' and v_m.destination_mode = 'external_customer' and v_m.counterparty_id is null then
    raise exception 'WZ zewnętrzne wymaga wskazania klienta.';
  end if;

  for v_line in
    select stock_item_id, sum(quantity)::numeric quantity
      from public.stock_movement_lines
     where workspace_id = p_workspace_id and movement_id = p_movement_id
     group by stock_item_id
     order by stock_item_id
  loop
    v_count := v_count + 1;
    if v_line.quantity <= 0 then raise exception 'Ilość musi być większa od zera.'; end if;
    if v_type in ('WZ','RW','MM') then
      select coalesce(quantity,0) into v_available
        from public.get_stock_balances(p_workspace_id)
       where warehouse_id = v_m.warehouse_id and stock_item_id = v_line.stock_item_id;
      if coalesce(v_available,0) + 0.000001 < v_line.quantity then
        raise exception 'Brak stanu magazynowego. Dostępne: %, wymagane: %.', coalesce(v_available,0), v_line.quantity;
      end if;
    end if;
  end loop;
  if v_count = 0 then raise exception 'Nie można zatwierdzić ruchu bez pozycji.'; end if;

  update public.stock_movements
     set status = 'approved', approved_by = p_actor_id, approved_at = now()
   where id = p_movement_id;

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(
    p_workspace_id,v_m.project_id,p_actor_id,'stock_movement.approved_flow_integrity','stock_movement',p_movement_id::text,
    jsonb_build_object('movement_type',v_type,'destination_mode',v_m.destination_mode,'counterparty_id',v_m.counterparty_id,'lines',v_count)
  );
  return p_movement_id;
end;
$function$;

revoke all on function public.approve_stock_movement_atomic(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.approve_stock_movement_atomic(uuid,uuid,uuid) to service_role;
