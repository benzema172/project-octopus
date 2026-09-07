-- Warehouse 4.3 — one responsible target per serialised asset and HR bridge.
-- Keeps stock-item instance ownership canonical while mirroring employee issues
-- into issued_assets so the employee card can show equipment without a second workflow.

create unique index if not exists issued_assets_open_stock_instance_uidx
  on public.issued_assets(workspace_id, asset_type, asset_id)
  where returned_at is null and asset_id is not null and asset_type = 'stock_instance';

create or replace function public.assign_stock_instance_atomic(
  p_workspace_id uuid,
  p_instance_id uuid,
  p_employee_id uuid,
  p_project_id uuid,
  p_vehicle_id uuid,
  p_event_date date,
  p_condition text,
  p_notes text,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $function$
declare
  v_instance public.stock_item_instances%rowtype;
  v_targets integer;
  v_description text;
  v_when timestamptz := (coalesce(p_event_date,current_date)::timestamp at time zone 'UTC');
begin
  select * into v_instance
    from public.stock_item_instances
   where id=p_instance_id and workspace_id=p_workspace_id
   for update;
  if not found then raise exception 'Egzemplarz nie należy do aktywnej firmy.'; end if;
  if v_instance.status in ('service','lost','retired') then raise exception 'Egzemplarz w tym stanie nie może zostać wydany.'; end if;

  v_targets := (case when p_employee_id is null then 0 else 1 end)
             + (case when p_project_id is null then 0 else 1 end)
             + (case when p_vehicle_id is null then 0 else 1 end);
  if v_targets <> 1 then
    raise exception 'Wskaż dokładnie jednego odpowiedzialnego: pracownika, inwestycję albo pojazd.';
  end if;

  if p_employee_id is not null then
    perform 1 from public.employees where id=p_employee_id and workspace_id=p_workspace_id and status='active';
    if not found then raise exception 'Pracownik nie jest aktywny w tej firmie.'; end if;
  end if;
  if p_project_id is not null then
    perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id and status in ('active','planned');
    if not found then raise exception 'Inwestycja nie jest aktywna lub planowana w tej firmie.'; end if;
  end if;
  if p_vehicle_id is not null then
    perform 1 from public.vehicles where id=p_vehicle_id and workspace_id=p_workspace_id;
    if not found then raise exception 'Pojazd nie należy do aktywnej firmy.'; end if;
  end if;

  select concat_ws(' · ', si.name,
                    case when nullif(trim(coalesce(v_instance.serial_number,'')),'') is not null then 'SN '||v_instance.serial_number end,
                    nullif(trim(coalesce(v_instance.asset_tag,'')),'') )
    into v_description
    from public.stock_items si
   where si.id=v_instance.stock_item_id and si.workspace_id=p_workspace_id;

  update public.issued_assets
     set returned_at = coalesce(returned_at, v_when),
         condition_in = coalesce(nullif(trim(coalesce(p_condition,'')),''), condition_in)
   where workspace_id=p_workspace_id
     and asset_type='stock_instance'
     and asset_id=p_instance_id
     and returned_at is null;

  update public.stock_item_instances
     set status='assigned', employee_id=p_employee_id, project_id=p_project_id, vehicle_id=p_vehicle_id,
         current_warehouse_id=null,
         condition=coalesce(nullif(trim(coalesce(p_condition,'')),''),condition),
         notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes), updated_at=now()
   where id=p_instance_id;

  insert into public.stock_instance_events(
    workspace_id,instance_id,event_type,employee_id,project_id,vehicle_id,event_date,condition,notes,created_by
  ) values (
    p_workspace_id,p_instance_id,'issued',p_employee_id,p_project_id,p_vehicle_id,
    coalesce(p_event_date,current_date),p_condition,p_notes,p_actor_id
  );

  if p_employee_id is not null then
    insert into public.issued_assets(
      workspace_id,employee_id,asset_type,asset_id,description,issued_at,condition_out
    ) values (
      p_workspace_id,p_employee_id,'stock_instance',p_instance_id,v_description,v_when,p_condition
    );
  end if;

  return p_instance_id;
end;
$function$;

create or replace function public.return_stock_instance_atomic(
  p_workspace_id uuid,
  p_instance_id uuid,
  p_warehouse_id uuid,
  p_event_date date,
  p_condition text,
  p_notes text,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $function$
declare
  v_when timestamptz := (coalesce(p_event_date,current_date)::timestamp at time zone 'UTC');
begin
  perform 1 from public.stock_item_instances where id=p_instance_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Egzemplarz nie należy do aktywnej firmy.'; end if;
  perform 1 from public.warehouses where id=p_warehouse_id and workspace_id=p_workspace_id and active;
  if not found then raise exception 'Magazyn zwrotu nie należy do aktywnej firmy.'; end if;

  update public.issued_assets
     set returned_at=v_when,
         condition_in=coalesce(nullif(trim(coalesce(p_condition,'')),''),condition_in)
   where workspace_id=p_workspace_id
     and asset_type='stock_instance'
     and asset_id=p_instance_id
     and returned_at is null;

  update public.stock_item_instances
     set status='available',employee_id=null,project_id=null,vehicle_id=null,current_warehouse_id=p_warehouse_id,
         condition=coalesce(nullif(trim(coalesce(p_condition,'')),''),condition),
         notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_at=now()
   where id=p_instance_id;
  insert into public.stock_instance_events(workspace_id,instance_id,event_type,warehouse_id,event_date,condition,notes,created_by)
  values(p_workspace_id,p_instance_id,'returned',p_warehouse_id,coalesce(p_event_date,current_date),p_condition,p_notes,p_actor_id);
  return p_instance_id;
end;
$function$;

insert into public.issued_assets(workspace_id,employee_id,asset_type,asset_id,description,issued_at,condition_out)
select sii.workspace_id, sii.employee_id, 'stock_instance', sii.id,
       concat_ws(' · ', si.name,
                 case when nullif(trim(coalesce(sii.serial_number,'')),'') is not null then 'SN '||sii.serial_number end,
                 nullif(trim(coalesce(sii.asset_tag,'')),'')),
       coalesce(sii.updated_at,sii.created_at,now()), sii.condition
  from public.stock_item_instances sii
  join public.stock_items si on si.id=sii.stock_item_id and si.workspace_id=sii.workspace_id
 where sii.status='assigned' and sii.employee_id is not null
   and not exists (
     select 1 from public.issued_assets ia
      where ia.workspace_id=sii.workspace_id and ia.asset_type='stock_instance'
        and ia.asset_id=sii.id and ia.returned_at is null
   );