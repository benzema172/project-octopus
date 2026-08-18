begin;

-- Project Octopus 1.0.1 — integrity fixes found by the post-1.0 audit.

create or replace function public.create_stock_movement_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_warehouse_id uuid,
  p_target_warehouse_id uuid,
  p_stock_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_cost numeric,
  p_document_number text,
  p_movement_date date,
  p_actor_id uuid
)
returns table(result_movement_id uuid, available_before numeric, available_after numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := upper(trim(coalesce(p_movement_type, '')));
  v_available numeric := 0;
  v_after numeric := 0;
  v_movement_id uuid;
begin
  if v_type not in ('PZ','WZ','RW','ZW','MM') then
    raise exception 'Nieobsługiwany typ ruchu magazynowego: %.', v_type;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Ilość ruchu magazynowego musi być większa od zera.';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Koszt jednostkowy nie może być ujemny.';
  end if;

  perform 1 from public.warehouses
  where id = p_warehouse_id and workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Magazyn źródłowy nie należy do aktywnej firmy.'; end if;

  perform 1 from public.stock_items
  where id = p_stock_item_id and workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Kartoteka nie należy do aktywnej firmy.'; end if;

  if p_project_id is not null then
    perform 1 from public.projects where id = p_project_id and workspace_id = p_workspace_id;
    if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  end if;

  if v_type = 'MM' then
    if p_target_warehouse_id is null then raise exception 'MM wymaga magazynu docelowego.'; end if;
    if p_target_warehouse_id = p_warehouse_id then raise exception 'Magazyn źródłowy i docelowy muszą być różne.'; end if;
    perform 1 from public.warehouses
    where id = p_target_warehouse_id and workspace_id = p_workspace_id
    for update;
    if not found then raise exception 'Magazyn docelowy nie należy do aktywnej firmy.'; end if;
  elsif p_target_warehouse_id is not null then
    raise exception 'Magazyn docelowy można wskazać tylko dla MM.';
  end if;

  select coalesce(b.quantity, 0) into v_available
  from public.get_stock_balances(p_workspace_id) b
  where b.warehouse_id = p_warehouse_id and b.stock_item_id = p_stock_item_id;
  v_available := coalesce(v_available, 0);

  if v_type in ('WZ','RW','MM') and v_available + 0.000001 < p_quantity then
    raise exception 'Brak wystarczającego stanu dla %. Dostępne: %, wymagane: %.', v_type, v_available, p_quantity;
  end if;

  insert into public.stock_movements(
    workspace_id, project_id, warehouse_id, target_warehouse_id,
    movement_type, document_number, movement_date, status, approved_by, approved_at
  ) values (
    p_workspace_id, p_project_id, p_warehouse_id,
    case when v_type = 'MM' then p_target_warehouse_id else null end,
    v_type,
    coalesce(nullif(trim(p_document_number), ''), v_type || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
    coalesce(p_movement_date, current_date), 'approved', p_actor_id, now()
  ) returning id into v_movement_id;

  insert into public.stock_movement_lines(workspace_id, movement_id, stock_item_id, quantity, unit_cost)
  values(p_workspace_id, v_movement_id, p_stock_item_id, p_quantity, p_unit_cost);

  v_after := case when v_type in ('PZ','ZW') then v_available + p_quantity else v_available - p_quantity end;

  insert into public.audit_events(workspace_id, project_id, actor_id, event_type, entity_type, entity_id, after_value)
  values(
    p_workspace_id, p_project_id, p_actor_id, 'stock_movement.created_atomic', 'stock_movement', v_movement_id::text,
    jsonb_build_object(
      'movement_type', v_type,
      'warehouse_id', p_warehouse_id,
      'target_warehouse_id', case when v_type = 'MM' then p_target_warehouse_id else null end,
      'stock_item_id', p_stock_item_id,
      'quantity', p_quantity,
      'available_before', v_available,
      'available_after', v_after
    )
  );

  return query select v_movement_id, v_available, v_after;
end;
$$;

create or replace function public.approve_stock_movement_atomic(
  p_workspace_id uuid,
  p_movement_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.stock_movements%rowtype;
  v_type text;
  v_line record;
  v_available numeric;
  v_line_count integer := 0;
begin
  select * into v_movement
  from public.stock_movements
  where id = p_movement_id and workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Ruch magazynowy nie należy do aktywnej firmy.'; end if;
  if v_movement.status <> 'draft' then raise exception 'Tylko szkic ruchu magazynowego można zatwierdzić.'; end if;

  v_type := upper(trim(coalesce(v_movement.movement_type, '')));
  if v_type not in ('PZ','WZ','RW','ZW','MM') then raise exception 'Nieobsługiwany typ ruchu magazynowego: %.', v_type; end if;

  perform 1 from public.warehouses where id = v_movement.warehouse_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Magazyn źródłowy nie należy do aktywnej firmy.'; end if;

  if v_movement.project_id is not null then
    perform 1 from public.projects where id = v_movement.project_id and workspace_id = p_workspace_id;
    if not found then raise exception 'Inwestycja ruchu nie należy do aktywnej firmy.'; end if;
  end if;

  if v_type = 'MM' then
    if v_movement.target_warehouse_id is null then raise exception 'MM wymaga magazynu docelowego.'; end if;
    if v_movement.target_warehouse_id = v_movement.warehouse_id then raise exception 'Magazyn źródłowy i docelowy muszą być różne.'; end if;
    perform 1 from public.warehouses where id = v_movement.target_warehouse_id and workspace_id = p_workspace_id for update;
    if not found then raise exception 'Magazyn docelowy nie należy do aktywnej firmy.'; end if;
  elsif v_movement.target_warehouse_id is not null then
    raise exception 'Magazyn docelowy można wskazać tylko dla MM.';
  end if;

  for v_line in
    select sml.stock_item_id, sum(sml.quantity)::numeric as quantity
    from public.stock_movement_lines sml
    where sml.workspace_id = p_workspace_id and sml.movement_id = p_movement_id
    group by sml.stock_item_id
    order by sml.stock_item_id
  loop
    v_line_count := v_line_count + 1;
    if v_line.quantity is null or v_line.quantity <= 0 then raise exception 'Pozycje ruchu muszą mieć ilość większą od zera.'; end if;

    perform 1 from public.stock_items
    where id = v_line.stock_item_id and workspace_id = p_workspace_id
    for update;
    if not found then raise exception 'Kartoteka ruchu nie należy do aktywnej firmy.'; end if;

    if v_type in ('WZ','RW','MM') then
      select coalesce(b.quantity, 0) into v_available
      from public.get_stock_balances(p_workspace_id) b
      where b.warehouse_id = v_movement.warehouse_id and b.stock_item_id = v_line.stock_item_id;
      v_available := coalesce(v_available, 0);
      if v_available + 0.000001 < v_line.quantity then
        raise exception 'Brak wystarczającego stanu dla %. Dostępne: %, wymagane: %.', v_type, v_available, v_line.quantity;
      end if;
    end if;
  end loop;

  if v_line_count = 0 then raise exception 'Nie można zatwierdzić ruchu bez pozycji.'; end if;

  update public.stock_movements
  set status = 'approved', approved_by = p_actor_id, approved_at = now()
  where id = p_movement_id and workspace_id = p_workspace_id;

  insert into public.audit_events(workspace_id, project_id, actor_id, event_type, entity_type, entity_id, after_value)
  values(
    p_workspace_id, v_movement.project_id, p_actor_id, 'stock_movement.approved_atomic', 'stock_movement', p_movement_id::text,
    jsonb_build_object('movement_type', v_type, 'line_groups', v_line_count)
  );

  return p_movement_id;
end;
$$;

create or replace function public.assign_document_to_project_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_project_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_project_id uuid;
begin
  if p_project_id is null then raise exception 'Inwestycja docelowa jest wymagana.'; end if;

  select d.project_id into v_previous_project_id
  from public.documents d
  where d.id = p_document_id and d.workspace_id = p_workspace_id
  for update;
  if not found then raise exception 'Dokument nie należy do aktywnej firmy.'; end if;

  perform 1 from public.projects p where p.id = p_project_id and p.workspace_id = p_workspace_id;
  if not found then raise exception 'Inwestycja docelowa nie należy do aktywnej firmy.'; end if;

  update public.documents set project_id = p_project_id, updated_at = now()
  where id = p_document_id and workspace_id = p_workspace_id;
  update public.document_versions set project_id = p_project_id
  where document_id = p_document_id;
  update public.document_extractions set project_id = p_project_id
  where workspace_id = p_workspace_id and document_id = p_document_id;
  update public.document_intakes set proposed_project_id = p_project_id
  where workspace_id = p_workspace_id and document_id = p_document_id;
  update public.document_classifications set proposed_project_id = p_project_id
  where workspace_id = p_workspace_id and document_id = p_document_id;
  update public.processing_jobs set project_id = p_project_id, updated_at = now()
  where workspace_id = p_workspace_id and document_id = p_document_id;

  insert into public.audit_events(workspace_id, project_id, actor_id, event_type, entity_type, entity_id, before_value, after_value)
  values(
    p_workspace_id, p_project_id, p_actor_id, 'document.assigned_project_atomic', 'document', p_document_id::text,
    jsonb_build_object('project_id', v_previous_project_id), jsonb_build_object('project_id', p_project_id)
  );

  return p_document_id;
end;
$$;

revoke all on function public.create_stock_movement_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,text,date,uuid) from public, anon, authenticated;
grant execute on function public.create_stock_movement_atomic(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,text,date,uuid) to service_role;
revoke all on function public.approve_stock_movement_atomic(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.approve_stock_movement_atomic(uuid,uuid,uuid) to service_role;
revoke all on function public.assign_document_to_project_atomic(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.assign_document_to_project_atomic(uuid,uuid,uuid,uuid) to service_role;

insert into public.app_schema_versions(version)
values ('20260818_101_stock_and_document_integrity')
on conflict (version) do update set applied_at = excluded.applied_at;

commit;
