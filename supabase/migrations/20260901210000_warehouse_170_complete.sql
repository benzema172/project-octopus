begin;

alter table public.stock_items add column if not exists category text;
alter table public.stock_items add column if not exists subcategory text;
alter table public.stock_items add column if not exists manufacturer text;
alter table public.stock_items add column if not exists model text;
alter table public.stock_items add column if not exists barcode text;
alter table public.stock_items add column if not exists optimal_stock numeric(18,4) not null default 0;
alter table public.stock_items add column if not exists warranty_months integer;
alter table public.stock_items add column if not exists updated_at timestamptz not null default now();

create unique index if not exists stock_items_workspace_barcode_uidx
  on public.stock_items(workspace_id,barcode) where barcode is not null and barcode<>'';
create index if not exists stock_items_workspace_category_idx
  on public.stock_items(workspace_id,item_type,category,active);

alter table public.inventory_counts add column if not exists notes text;
alter table public.inventory_counts add column if not exists started_by uuid references auth.users(id) on delete set null;
alter table public.inventory_counts add column if not exists approved_at timestamptz;
create index if not exists inventory_counts_started_by_fk_idx on public.inventory_counts(started_by);

create table if not exists public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  inventory_count_id uuid not null references public.inventory_counts(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete restrict,
  system_quantity numeric(18,4) not null default 0,
  counted_quantity numeric(18,4),
  difference numeric(18,4),
  unit_cost numeric(18,4),
  note text,
  updated_at timestamptz not null default now(),
  unique(inventory_count_id,stock_item_id)
);
create index if not exists inventory_count_lines_workspace_count_idx
  on public.inventory_count_lines(workspace_id,inventory_count_id,stock_item_id);
create index if not exists inventory_count_lines_stock_item_fk_idx
  on public.inventory_count_lines(stock_item_id);

create table if not exists public.stock_item_instances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete restrict,
  serial_number text not null,
  asset_tag text,
  purchase_date date,
  purchase_price numeric(18,2),
  warranty_until date,
  status text not null default 'available' check(status in('available','assigned','service','lost','damaged','retired')),
  condition text,
  current_warehouse_id uuid references public.warehouses(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  last_service_date date,
  next_service_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,serial_number)
);
create unique index if not exists stock_item_instances_asset_tag_uidx
  on public.stock_item_instances(workspace_id,asset_tag) where asset_tag is not null and asset_tag<>'';
create index if not exists stock_item_instances_item_status_idx
  on public.stock_item_instances(workspace_id,stock_item_id,status);
create index if not exists stock_item_instances_stock_item_fk_idx
  on public.stock_item_instances(stock_item_id);
create index if not exists stock_item_instances_employee_idx
  on public.stock_item_instances(workspace_id,employee_id) where employee_id is not null;
create index if not exists stock_item_instances_current_warehouse_fk_idx on public.stock_item_instances(current_warehouse_id);
create index if not exists stock_item_instances_employee_fk_idx on public.stock_item_instances(employee_id);
create index if not exists stock_item_instances_project_fk_idx on public.stock_item_instances(project_id);
create index if not exists stock_item_instances_vehicle_fk_idx on public.stock_item_instances(vehicle_id);

create table if not exists public.stock_instance_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  instance_id uuid not null references public.stock_item_instances(id) on delete cascade,
  event_type text not null check(event_type in('registered','issued','returned','transferred','service','damaged','lost','retired')),
  employee_id uuid references public.employees(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  event_date date not null default current_date,
  condition text,
  cost numeric(18,2),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stock_instance_events_instance_date_idx
  on public.stock_instance_events(workspace_id,instance_id,event_date desc,created_at desc);
create index if not exists stock_instance_events_instance_fk_idx on public.stock_instance_events(instance_id);
create index if not exists stock_instance_events_employee_fk_idx on public.stock_instance_events(employee_id);
create index if not exists stock_instance_events_project_fk_idx on public.stock_instance_events(project_id);
create index if not exists stock_instance_events_vehicle_fk_idx on public.stock_instance_events(vehicle_id);
create index if not exists stock_instance_events_warehouse_fk_idx on public.stock_instance_events(warehouse_id);
create index if not exists stock_instance_events_created_by_fk_idx on public.stock_instance_events(created_by);

alter table public.inventory_count_lines enable row level security;
alter table public.stock_item_instances enable row level security;
alter table public.stock_instance_events enable row level security;

drop policy if exists inventory_count_lines_read on public.inventory_count_lines;
create policy inventory_count_lines_read on public.inventory_count_lines for select to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','read',null));
drop policy if exists inventory_count_lines_write on public.inventory_count_lines;
create policy inventory_count_lines_write on public.inventory_count_lines for all to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','write',null))
  with check(public.has_domain_access(workspace_id,'warehouse','write',null));

drop policy if exists stock_item_instances_read on public.stock_item_instances;
create policy stock_item_instances_read on public.stock_item_instances for select to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','read',project_id) or public.has_domain_access(workspace_id,'hr','read',project_id));
drop policy if exists stock_item_instances_write on public.stock_item_instances;
create policy stock_item_instances_write on public.stock_item_instances for all to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','write',project_id))
  with check(public.has_domain_access(workspace_id,'warehouse','write',project_id));

drop policy if exists stock_instance_events_read on public.stock_instance_events;
create policy stock_instance_events_read on public.stock_instance_events for select to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','read',project_id) or public.has_domain_access(workspace_id,'hr','read',project_id));
drop policy if exists stock_instance_events_write on public.stock_instance_events;
create policy stock_instance_events_write on public.stock_instance_events for all to authenticated
  using(public.has_domain_access(workspace_id,'warehouse','write',project_id))
  with check(public.has_domain_access(workspace_id,'warehouse','write',project_id));

grant select,insert,update,delete on public.inventory_count_lines to authenticated,service_role;
grant select,insert,update,delete on public.stock_item_instances to authenticated,service_role;
grant select,insert,update,delete on public.stock_instance_events to authenticated,service_role;

create or replace function public.import_ai_warehouse_document_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_warehouse_id uuid,
  p_source_document_id uuid,
  p_document_number text,
  p_movement_date date,
  p_movement_type text,
  p_lines jsonb,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_warehouse_id uuid:=p_warehouse_id;
  v_movement_id uuid;
  v_item_id uuid;
  v_line_id uuid;
  v_line jsonb;
  v_type text:=upper(trim(coalesce(p_movement_type,'PZ')));
  v_line_type text;
  v_description text;
  v_sku text;
  v_key text;
  v_unit text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_count integer:=0;
begin
  if v_type not in('PZ','WZ') then raise exception 'Import AI obsługuje wyłącznie szkic PZ lub WZ.'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Dokument nie zawiera prawidłowej listy pozycji.'; end if;
  perform 1 from public.documents where id=p_source_document_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Dokument źródłowy nie należy do aktywnej firmy.'; end if;
  if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.';end if;end if;
  if exists(select 1 from public.stock_movements where workspace_id=p_workspace_id and source_document_id=p_source_document_id) then raise exception 'Ten dokument został już zaczytany do Magazynu.'; end if;
  if v_warehouse_id is not null then
    perform 1 from public.warehouses where id=v_warehouse_id and workspace_id=p_workspace_id and active;
    if not found then raise exception 'Magazyn nie należy do aktywnej firmy lub jest nieaktywny.'; end if;
  else
    select id into v_warehouse_id from public.warehouses where workspace_id=p_workspace_id and active order by case when warehouse_type='central' then 0 else 1 end,created_at limit 1;
    if v_warehouse_id is null then
      insert into public.warehouses(workspace_id,name,warehouse_type,active) values(p_workspace_id,'Magazyn główny','central',true) returning id into v_warehouse_id;
    end if;
  end if;

  insert into public.stock_movements(workspace_id,project_id,warehouse_id,movement_type,document_number,movement_date,status,source_document_id,source_group_key,destination_mode)
  values(p_workspace_id,p_project_id,v_warehouse_id,v_type,nullif(trim(coalesce(p_document_number,'')),''),coalesce(p_movement_date,current_date),'draft',p_source_document_id,'warehouse-ai',case when v_type='PZ' and p_project_id is not null then 'direct_project' when v_type='PZ' then 'central_stock' else 'unassigned' end)
  returning id into v_movement_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_type:=lower(coalesce(nullif(trim(v_line->>'lineType'),''),'material'));
    if v_line_type not in('material','equipment','device','tool') then continue; end if;
    v_description:=nullif(trim(v_line->>'description'),'');
    if v_description is null then continue; end if;
    begin v_quantity:=replace(coalesce(nullif(v_line->>'quantity',''),'0'),',','.')::numeric; exception when others then v_quantity:=0; end;
    if coalesce(v_quantity,0)<=0 then continue; end if;
    begin v_unit_cost:=replace(coalesce(nullif(v_line->>'unitPrice',''),'0'),',','.')::numeric; exception when others then v_unit_cost:=null; end;
    if coalesce(v_unit_cost,0)<=0 then v_unit_cost:=null; end if;
    v_sku:=nullif(trim(coalesce(v_line->>'sku',v_line->>'supplierSku','')),'');
    v_unit:=coalesce(nullif(trim(v_line->>'unit'),''),'szt.');
    v_key:=public.normalize_material_key(v_description);
    v_item_id:=null;

    if v_sku is not null then select stock_item_id into v_item_id from public.material_aliases where workspace_id=p_workspace_id and supplier_sku=v_sku and status='approved' order by confidence desc,created_at limit 1; end if;
    if v_item_id is null and v_key<>'' then select stock_item_id into v_item_id from public.material_aliases where workspace_id=p_workspace_id and normalized_key=v_key and status='approved' order by confidence desc,created_at limit 1; end if;
    if v_item_id is null and v_sku is not null then select id into v_item_id from public.stock_items where workspace_id=p_workspace_id and sku=v_sku limit 1; end if;
    if v_item_id is null then select id into v_item_id from public.stock_items where workspace_id=p_workspace_id and public.normalize_material_key(name)=v_key order by created_at limit 1; end if;
    if v_item_id is null then
      insert into public.stock_items(workspace_id,sku,name,item_type,unit,serial_tracking)
      values(p_workspace_id,v_sku,v_description,case when v_line_type in('equipment','device') then 'device' when v_line_type='tool' then 'tool' else 'material' end,v_unit,v_line_type in('equipment','device','tool'))
      returning id into v_item_id;
    end if;
    if v_key<>'' then
      insert into public.material_aliases(workspace_id,stock_item_id,supplier_sku,supplier_name,normalized_key,confidence,status,created_by)
      values(p_workspace_id,v_item_id,v_sku,v_description,v_key,case when v_sku is not null then 0.98 else 0.86 end,'approved',p_actor_id)
      on conflict do nothing;
    end if;
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity,unit_cost)
    values(p_workspace_id,v_movement_id,v_item_id,v_quantity,v_unit_cost) returning id into v_line_id;
    v_count:=v_count+1;
  end loop;
  if v_count=0 then delete from public.stock_movements where id=v_movement_id;raise exception 'Dokument nie zawiera fizycznych pozycji z prawidłową ilością. Usługi nie trafiają do stanu magazynowego.';end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'warehouse.ai_imported','stock_movement',v_movement_id::text,jsonb_build_object('movement_type',v_type,'source_document_id',p_source_document_id,'material_lines',v_count,'status','draft'));
  return v_movement_id;
end;
$$;

create or replace function public.start_inventory_count_atomic(p_workspace_id uuid,p_warehouse_id uuid,p_count_date date,p_notes text,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count_id uuid;
begin
  perform 1 from public.warehouses where id=p_warehouse_id and workspace_id=p_workspace_id and active;if not found then raise exception 'Magazyn nie należy do aktywnej firmy.';end if;
  if exists(select 1 from public.inventory_counts where workspace_id=p_workspace_id and warehouse_id=p_warehouse_id and status in('draft','open','in_progress')) then raise exception 'Dla tego magazynu istnieje już otwarta inwentaryzacja.';end if;
  insert into public.inventory_counts(workspace_id,warehouse_id,count_date,status,snapshot,notes,started_by)
  values(p_workspace_id,p_warehouse_id,coalesce(p_count_date,current_date),'in_progress','{}'::jsonb,nullif(trim(coalesce(p_notes,'')),''),p_actor_id) returning id into v_count_id;
  insert into public.inventory_count_lines(workspace_id,inventory_count_id,stock_item_id,system_quantity,counted_quantity,difference,unit_cost)
  select p_workspace_id,v_count_id,si.id,coalesce(b.quantity,0),null,null,
    (select icl.unit_cost from public.inventory_cost_layers icl where icl.workspace_id=p_workspace_id and icl.warehouse_id=p_warehouse_id and icl.stock_item_id=si.id and icl.remaining_quantity>0 order by icl.received_at desc,icl.id desc limit 1)
  from public.stock_items si left join public.get_stock_balances(p_workspace_id)b on b.stock_item_id=si.id and b.warehouse_id=p_warehouse_id
  where si.workspace_id=p_workspace_id and si.active;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,p_actor_id,'inventory_count.started','inventory_count',v_count_id::text,jsonb_build_object('warehouse_id',p_warehouse_id));
  return v_count_id;
end;$$;

create or replace function public.update_inventory_count_line_atomic(p_workspace_id uuid,p_line_id uuid,p_counted_quantity numeric,p_note text,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_line public.inventory_count_lines%rowtype;v_status text;
begin
  if p_counted_quantity<0 then raise exception 'Stan policzony nie może być ujemny.';end if;
  select * into v_line from public.inventory_count_lines where id=p_line_id and workspace_id=p_workspace_id for update;if not found then raise exception 'Pozycja spisu nie należy do aktywnej firmy.';end if;
  select status into v_status from public.inventory_counts where id=v_line.inventory_count_id for update;if v_status not in('draft','open','in_progress') then raise exception 'Zamkniętej inwentaryzacji nie można edytować.';end if;
  update public.inventory_count_lines set counted_quantity=p_counted_quantity,difference=p_counted_quantity-system_quantity,note=nullif(trim(coalesce(p_note,'')),''),updated_at=now() where id=p_line_id;
  return p_line_id;
end;$$;

create or replace function public.approve_inventory_count_atomic(p_workspace_id uuid,p_count_id uuid,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count public.inventory_counts%rowtype;v_pz uuid;v_rw uuid;v_missing integer;v_positive integer;v_negative integer;
begin
  select * into v_count from public.inventory_counts where id=p_count_id and workspace_id=p_workspace_id for update;if not found then raise exception 'Inwentaryzacja nie należy do aktywnej firmy.';end if;
  if v_count.status not in('draft','open','in_progress') then raise exception 'Tylko otwartą inwentaryzację można zatwierdzić.';end if;
  select count(*) into v_missing from public.inventory_count_lines where inventory_count_id=p_count_id and counted_quantity is null;if v_missing>0 then raise exception 'Uzupełnij wszystkie pozycje spisu. Brakuje: %.',v_missing;end if;
  select count(*) filter(where difference>0),count(*) filter(where difference<0) into v_positive,v_negative from public.inventory_count_lines where inventory_count_id=p_count_id;
  if v_positive>0 then
    insert into public.stock_movements(workspace_id,warehouse_id,movement_type,document_number,movement_date,status,approved_by,approved_at,destination_mode)
    values(p_workspace_id,v_count.warehouse_id,'PZ','INW+'||to_char(v_count.count_date,'YYYYMMDD'),v_count.count_date,'approved',p_actor_id,now(),'central_stock') returning id into v_pz;
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity,unit_cost)
    select p_workspace_id,v_pz,stock_item_id,difference,unit_cost from public.inventory_count_lines where inventory_count_id=p_count_id and difference>0;
  end if;
  if v_negative>0 then
    insert into public.stock_movements(workspace_id,warehouse_id,movement_type,document_number,movement_date,status,approved_by,approved_at,destination_mode)
    values(p_workspace_id,v_count.warehouse_id,'RW','INW-'||to_char(v_count.count_date,'YYYYMMDD'),v_count.count_date,'approved',p_actor_id,now(),'unassigned') returning id into v_rw;
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity,unit_cost)
    select p_workspace_id,v_rw,stock_item_id,abs(difference),unit_cost from public.inventory_count_lines where inventory_count_id=p_count_id and difference<0;
  end if;
  update public.inventory_counts set status='approved',approved_by=p_actor_id,approved_at=now(),snapshot=jsonb_build_object('positive_lines',v_positive,'negative_lines',v_negative,'pz_id',v_pz,'rw_id',v_rw) where id=p_count_id;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,after_value) values(p_workspace_id,p_actor_id,'inventory_count.approved','inventory_count',p_count_id::text,jsonb_build_object('positive_lines',v_positive,'negative_lines',v_negative,'pz_id',v_pz,'rw_id',v_rw));
  return p_count_id;
end;$$;

create or replace function public.create_stock_instance_atomic(p_workspace_id uuid,p_stock_item_id uuid,p_warehouse_id uuid,p_serial_number text,p_asset_tag text,p_purchase_date date,p_purchase_price numeric,p_warranty_until date,p_condition text,p_notes text,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if nullif(trim(coalesce(p_serial_number,'')),'') is null then raise exception 'Numer seryjny jest wymagany.';end if;
  perform 1 from public.stock_items where id=p_stock_item_id and workspace_id=p_workspace_id;if not found then raise exception 'Kartoteka nie należy do aktywnej firmy.';end if;
  if p_warehouse_id is not null then perform 1 from public.warehouses where id=p_warehouse_id and workspace_id=p_workspace_id;if not found then raise exception 'Magazyn nie należy do aktywnej firmy.';end if;end if;
  insert into public.stock_item_instances(workspace_id,stock_item_id,serial_number,asset_tag,purchase_date,purchase_price,warranty_until,current_warehouse_id,condition,notes)
  values(p_workspace_id,p_stock_item_id,trim(p_serial_number),nullif(trim(coalesce(p_asset_tag,'')),''),p_purchase_date,p_purchase_price,p_warranty_until,p_warehouse_id,nullif(trim(coalesce(p_condition,'')),''),nullif(trim(coalesce(p_notes,'')),'')) returning id into v_id;
  update public.stock_items set serial_tracking=true,updated_at=now() where id=p_stock_item_id;
  insert into public.stock_instance_events(workspace_id,instance_id,event_type,warehouse_id,event_date,condition,notes,created_by) values(p_workspace_id,v_id,'registered',p_warehouse_id,coalesce(p_purchase_date,current_date),p_condition,p_notes,p_actor_id);
  return v_id;
end;$$;

create or replace function public.assign_stock_instance_atomic(p_workspace_id uuid,p_instance_id uuid,p_employee_id uuid,p_project_id uuid,p_vehicle_id uuid,p_event_date date,p_condition text,p_notes text,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_instance public.stock_item_instances%rowtype;v_targets integer;
begin
  select * into v_instance from public.stock_item_instances where id=p_instance_id and workspace_id=p_workspace_id for update;if not found then raise exception 'Egzemplarz nie należy do aktywnej firmy.';end if;
  if v_instance.status in('service','lost','retired') then raise exception 'Egzemplarz w tym stanie nie może zostać wydany.';end if;
  v_targets:=(case when p_employee_id is null then 0 else 1 end)+(case when p_project_id is null then 0 else 1 end)+(case when p_vehicle_id is null then 0 else 1 end);
  if v_targets=0 then raise exception 'Wskaż pracownika, inwestycję albo pojazd.';end if;
  if p_employee_id is not null then perform 1 from public.employees where id=p_employee_id and workspace_id=p_workspace_id;if not found then raise exception 'Pracownik nie należy do aktywnej firmy.';end if;end if;
  if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.';end if;end if;
  if p_vehicle_id is not null then perform 1 from public.vehicles where id=p_vehicle_id and workspace_id=p_workspace_id;if not found then raise exception 'Pojazd nie należy do aktywnej firmy.';end if;end if;
  update public.stock_item_instances set status='assigned',employee_id=p_employee_id,project_id=p_project_id,vehicle_id=p_vehicle_id,current_warehouse_id=null,condition=coalesce(nullif(trim(coalesce(p_condition,'')),''),condition),notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_at=now() where id=p_instance_id;
  insert into public.stock_instance_events(workspace_id,instance_id,event_type,employee_id,project_id,vehicle_id,event_date,condition,notes,created_by) values(p_workspace_id,p_instance_id,'issued',p_employee_id,p_project_id,p_vehicle_id,coalesce(p_event_date,current_date),p_condition,p_notes,p_actor_id);
  return p_instance_id;
end;$$;

create or replace function public.return_stock_instance_atomic(p_workspace_id uuid,p_instance_id uuid,p_warehouse_id uuid,p_event_date date,p_condition text,p_notes text,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.stock_item_instances where id=p_instance_id and workspace_id=p_workspace_id for update;if not found then raise exception 'Egzemplarz nie należy do aktywnej firmy.';end if;
  perform 1 from public.warehouses where id=p_warehouse_id and workspace_id=p_workspace_id and active;if not found then raise exception 'Magazyn zwrotu nie należy do aktywnej firmy.';end if;
  update public.stock_item_instances set status='available',employee_id=null,project_id=null,vehicle_id=null,current_warehouse_id=p_warehouse_id,condition=coalesce(nullif(trim(coalesce(p_condition,'')),''),condition),notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_at=now() where id=p_instance_id;
  insert into public.stock_instance_events(workspace_id,instance_id,event_type,warehouse_id,event_date,condition,notes,created_by) values(p_workspace_id,p_instance_id,'returned',p_warehouse_id,coalesce(p_event_date,current_date),p_condition,p_notes,p_actor_id);
  return p_instance_id;
end;$$;

create or replace function public.record_stock_instance_service_atomic(p_workspace_id uuid,p_instance_id uuid,p_event_date date,p_next_service_date date,p_cost numeric,p_condition text,p_notes text,p_actor_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_instance public.stock_item_instances%rowtype;
begin
  select * into v_instance from public.stock_item_instances where id=p_instance_id and workspace_id=p_workspace_id for update;if not found then raise exception 'Egzemplarz nie należy do aktywnej firmy.';end if;
  update public.stock_item_instances set status=case when p_next_service_date is null then 'service' when v_instance.employee_id is not null or v_instance.project_id is not null or v_instance.vehicle_id is not null then 'assigned' else 'available' end,last_service_date=coalesce(p_event_date,current_date),next_service_date=p_next_service_date,condition=coalesce(nullif(trim(coalesce(p_condition,'')),''),condition),notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_at=now() where id=p_instance_id;
  insert into public.stock_instance_events(workspace_id,instance_id,event_type,event_date,condition,cost,notes,created_by) values(p_workspace_id,p_instance_id,'service',coalesce(p_event_date,current_date),p_condition,p_cost,p_notes,p_actor_id);
  insert into public.tool_service_events(workspace_id,stock_item_id,event_type,event_date,next_due_date,cost) values(p_workspace_id,v_instance.stock_item_id,'service',coalesce(p_event_date,current_date),p_next_service_date,p_cost);
  return p_instance_id;
end;$$;

revoke all on function public.import_ai_warehouse_document_atomic(uuid,uuid,uuid,uuid,text,date,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.import_ai_warehouse_document_atomic(uuid,uuid,uuid,uuid,text,date,text,jsonb,uuid) to service_role;
revoke all on function public.start_inventory_count_atomic(uuid,uuid,date,text,uuid) from public,anon,authenticated;
grant execute on function public.start_inventory_count_atomic(uuid,uuid,date,text,uuid) to service_role;
revoke all on function public.update_inventory_count_line_atomic(uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.update_inventory_count_line_atomic(uuid,uuid,numeric,text,uuid) to service_role;
revoke all on function public.approve_inventory_count_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_inventory_count_atomic(uuid,uuid,uuid) to service_role;
revoke all on function public.create_stock_instance_atomic(uuid,uuid,uuid,text,text,date,numeric,date,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_stock_instance_atomic(uuid,uuid,uuid,text,text,date,numeric,date,text,text,uuid) to service_role;
revoke all on function public.assign_stock_instance_atomic(uuid,uuid,uuid,uuid,uuid,date,text,text,uuid) from public,anon,authenticated;
grant execute on function public.assign_stock_instance_atomic(uuid,uuid,uuid,uuid,uuid,date,text,text,uuid) to service_role;
revoke all on function public.return_stock_instance_atomic(uuid,uuid,uuid,date,text,text,uuid) from public,anon,authenticated;
grant execute on function public.return_stock_instance_atomic(uuid,uuid,uuid,date,text,text,uuid) to service_role;
revoke all on function public.record_stock_instance_service_atomic(uuid,uuid,date,date,numeric,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_stock_instance_service_atomic(uuid,uuid,date,date,numeric,text,text,uuid) to service_role;

insert into public.app_schema_versions(version) values('20260901_warehouse_170_complete') on conflict(version) do nothing;

commit;
