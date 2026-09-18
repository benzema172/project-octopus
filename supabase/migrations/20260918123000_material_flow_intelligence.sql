-- Material Flow Intelligence
-- Semantyka: faktura = zakup/cena, PZ = przyjęcie, MM/RW/WZ = przepływ/zużycie.
-- Koszt inwestycji pochodzi z wcześniejszych warstw PZ metodą FIFO, nigdy z wymyślonej ceny MM.

alter table public.warehouse_document_reviews
  add column if not exists recipient_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists recipient_employee_label text,
  add column if not exists project_match_confidence numeric(5,4),
  add column if not exists material_flow_metadata jsonb not null default '{}'::jsonb;

alter table public.stock_movements
  add column if not exists recipient_employee_id uuid references public.employees(id) on delete set null,
  add column if not exists recipient_employee_label text;

create index if not exists idx_stock_movements_recipient_employee
  on public.stock_movements(workspace_id, recipient_employee_id, movement_date desc)
  where recipient_employee_id is not null;

create index if not exists idx_stock_movements_recipient_employee_fk
  on public.stock_movements(recipient_employee_id);
create index if not exists idx_warehouse_document_reviews_recipient_employee_fk
  on public.warehouse_document_reviews(recipient_employee_id);

create table if not exists public.stock_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  outbound_movement_line_id uuid not null references public.stock_movement_lines(id) on delete cascade,
  source_movement_line_id uuid not null references public.stock_movement_lines(id) on delete cascade,
  source_invoice_line_id uuid references public.invoice_lines(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  costing_method text not null default 'fifo' check (costing_method in ('fifo','fallback')),
  created_at timestamptz not null default now(),
  unique(outbound_movement_line_id, source_movement_line_id)
);

create index if not exists idx_stock_cost_allocations_source
  on public.stock_cost_allocations(workspace_id, source_movement_line_id);
create index if not exists idx_stock_cost_allocations_project
  on public.stock_cost_allocations(workspace_id, project_id, created_at desc)
  where project_id is not null;
create index if not exists idx_stock_cost_allocations_invoice_line
  on public.stock_cost_allocations(source_invoice_line_id);
create index if not exists idx_stock_cost_allocations_project_fk
  on public.stock_cost_allocations(project_id);

alter table public.stock_cost_allocations enable row level security;
drop policy if exists "warehouse members read stock cost allocations" on public.stock_cost_allocations;
create policy "warehouse members read stock cost allocations" on public.stock_cost_allocations
for select using (private.has_domain_access(workspace_id,'warehouse','read',project_id));

create or replace function private.enrich_material_flow_review_context()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_payload jsonb;
  v_business jsonb;
  v_project uuid;
  v_project_conf numeric := null;
  v_employee uuid;
  v_employee_label text;
  v_code text;
  v_name text;
  v_address text;
  v_emp_name text;
  v_emp_no text;
begin
  select de.payload into v_payload
  from public.document_extractions de
  where de.document_version_id=new.document_version_id
    and de.extraction_type='document_context'
    and de.status<>'rejected'
  order by de.created_at desc
  limit 1;

  if jsonb_typeof(v_payload->'businessDocuments')='array' then
    v_business := v_payload->'businessDocuments'->greatest(coalesce(new.source_document_index,1)-1,0);
  elsif jsonb_typeof(v_payload->'businessDocument')='object' then
    v_business := v_payload->'businessDocument';
  else
    return new;
  end if;

  v_code := nullif(trim(v_business->>'projectCode'),'');
  v_name := nullif(trim(v_business->>'projectName'),'');
  v_address := nullif(trim(v_business->>'projectAddress'),'');
  v_emp_name := nullif(trim(v_business->>'recipientEmployeeName'),'');
  v_emp_no := nullif(trim(v_business->>'recipientEmployeeNumber'),'');
  v_employee_label := coalesce(v_emp_name,v_emp_no);

  v_project := new.project_id;
  if v_project is not null then
    v_project_conf := 1;
  elsif v_code is not null then
    select p.id into v_project
    from public.projects p
    where p.workspace_id=new.workspace_id
      and lower(trim(coalesce(p.code,'')))=lower(trim(v_code))
      and lower(coalesce(p.status,'')) not in ('archived','cancelled')
    order by p.created_at desc limit 1;
    if v_project is not null then v_project_conf := 0.999; end if;
  end if;

  if v_project is null and v_name is not null then
    select p.id into v_project
    from public.projects p
    where p.workspace_id=new.workspace_id
      and public.normalize_material_key(coalesce(p.name,''))=public.normalize_material_key(v_name)
      and lower(coalesce(p.status,'')) not in ('archived','cancelled')
    order by p.created_at desc limit 1;
    if v_project is not null then v_project_conf := 0.97; end if;
  end if;

  if v_project is null and v_address is not null and length(public.normalize_material_key(v_address))>=6 then
    select p.id into v_project
    from public.projects p
    where p.workspace_id=new.workspace_id
      and lower(coalesce(p.status,'')) not in ('archived','cancelled')
      and (
        public.normalize_material_key(coalesce(p.site_address,'')) like '%'||public.normalize_material_key(v_address)||'%'
        or public.normalize_material_key(coalesce(p.location,'')) like '%'||public.normalize_material_key(v_address)||'%'
        or public.normalize_material_key(v_address) like '%'||public.normalize_material_key(coalesce(p.site_address,''))||'%'
      )
    order by p.created_at desc limit 1;
    if v_project is not null then v_project_conf := 0.90; end if;
  end if;

  if v_emp_no is not null then
    select e.id into v_employee
    from public.employees e
    where e.workspace_id=new.workspace_id
      and lower(trim(coalesce(e.employee_number,'')))=lower(trim(v_emp_no))
      and lower(coalesce(e.status,'')) not in ('inactive','terminated')
    order by e.created_at desc limit 1;
  end if;

  if v_employee is null and v_emp_name is not null then
    select e.id into v_employee
    from public.employees e
    where e.workspace_id=new.workspace_id
      and public.normalize_material_key(trim(coalesce(e.first_name,'')||' '||coalesce(e.last_name,'')))=
          public.normalize_material_key(v_emp_name)
      and lower(coalesce(e.status,'')) not in ('inactive','terminated')
    order by e.created_at desc limit 1;
  end if;

  update public.warehouse_document_reviews
     set project_id=coalesce(project_id,v_project),
         project_match_confidence=coalesce(project_match_confidence,v_project_conf),
         recipient_employee_id=v_employee,
         recipient_employee_label=v_employee_label,
         material_flow_metadata=coalesce(material_flow_metadata,'{}'::jsonb)||jsonb_build_object(
           'documentType',upper(coalesce(v_business->>'documentType','')),
           'projectCode',v_code,
           'projectName',v_name,
           'projectAddress',v_address,
           'recipientEmployeeName',v_emp_name,
           'recipientEmployeeNumber',v_emp_no,
           'sourceWarehouse',nullif(trim(v_business->>'sourceWarehouse'),''),
           'targetWarehouse',nullif(trim(v_business->>'targetWarehouse'),''),
           'contextMatchedAt',now()
         ),
         updated_at=now()
   where id=new.id;

  return new;
end;
$$;

revoke all on function private.enrich_material_flow_review_context() from public;

drop trigger if exists warehouse_review_material_flow_context on public.warehouse_document_reviews;
create trigger warehouse_review_material_flow_context
after insert or update of document_version_id,source_document_index,document_type on public.warehouse_document_reviews
for each row execute function private.enrich_material_flow_review_context();

create or replace function private.create_warehouse_draft_for_review_31(p_review_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path='public','private','pg_temp'
as $$
declare
  v_review public.warehouse_document_reviews%rowtype;
  v_warehouse uuid;
  v_movement uuid;
  v_invoice uuid;
  v_type text;
  v_lines integer;
  v_existing_status text;
  v_group_key text;
  v_destination text;
begin
  select * into v_review from public.warehouse_document_reviews where id=p_review_id for update;
  if not found or v_review.status<>'warehouse' then return null; end if;
  if exists(select 1 from public.warehouse_ai_lines where review_id=p_review_id and decision in('needs_review','new_item_proposed')) then return null; end if;
  if (select count(*) from public.warehouse_ai_lines where review_id=p_review_id)<greatest(v_review.source_line_count,1) then return null; end if;

  v_group_key := 'warehouse-ai-31:'||p_review_id::text;
  v_type := upper(trim(coalesce(v_review.document_type,'')));
  if v_type not in ('PZ','WZ','MM','RW','ZW') then
    v_type := case when lower(coalesce(v_review.document_direction,'')) in('sale','outgoing','outbound','issue','sales') then 'WZ' else 'PZ' end;
  end if;

  v_invoice := case when upper(coalesce(v_review.document_type,''))='INVOICE' then v_review.invoice_id else null end;
  if v_invoice is null and upper(coalesce(v_review.document_type,''))='INVOICE' then
    select i.id into v_invoice
    from public.invoices i
    where i.workspace_id=v_review.workspace_id
      and i.document_id=v_review.document_id
      and (v_review.document_number is null or i.invoice_number=v_review.document_number)
    order by i.created_at desc limit 1;
  end if;

  if v_review.draft_movement_id is not null then
    select status into v_existing_status from public.stock_movements where id=v_review.draft_movement_id;
    if v_existing_status is not null and v_existing_status<>'draft' then return v_review.draft_movement_id; end if;
    if v_existing_status='draft' then
      delete from public.stock_movement_lines where movement_id=v_review.draft_movement_id;
      v_movement:=v_review.draft_movement_id;
    end if;
  end if;

  if v_movement is null and v_invoice is not null then
    select sm.id,sm.status into v_movement,v_existing_status
    from public.stock_movements sm
    where sm.workspace_id=v_review.workspace_id and sm.source_invoice_id=v_invoice
    order by case when sm.status='draft' then 0 else 1 end,sm.created_at desc
    limit 1 for update;
    if v_movement is not null and v_existing_status<>'draft' then
      update public.warehouse_document_reviews set draft_movement_id=v_movement where id=p_review_id;
      return v_movement;
    end if;
    if v_movement is not null then delete from public.stock_movement_lines where movement_id=v_movement; end if;
  end if;

  if v_movement is null then
    select sm.id,sm.status into v_movement,v_existing_status
    from public.stock_movements sm
    where sm.workspace_id=v_review.workspace_id
      and sm.source_document_id=v_review.document_id
      and sm.source_group_key=v_group_key
    order by sm.created_at desc limit 1 for update;
    if v_movement is not null and v_existing_status<>'draft' then return v_movement; end if;
    if v_movement is not null then delete from public.stock_movement_lines where movement_id=v_movement; end if;
  end if;

  select id into v_warehouse from public.warehouses
  where workspace_id=v_review.workspace_id and active
  order by case when warehouse_type='central' then 0 else 1 end,created_at limit 1;
  if v_warehouse is null then
    insert into public.warehouses(workspace_id,name,warehouse_type,active)
    values(v_review.workspace_id,'Magazyn główny','central',true) returning id into v_warehouse;
  end if;

  v_destination := case
    when v_type='PZ' then 'central_stock'
    when v_type in ('MM','RW','WZ') and v_review.project_id is not null then 'direct_project'
    when v_type='ZW' then 'central_stock'
    else 'unassigned'
  end;

  if v_movement is null then
    insert into public.stock_movements(
      workspace_id,project_id,warehouse_id,target_warehouse_id,movement_type,document_number,movement_date,status,
      source_document_id,source_invoice_id,source_group_key,destination_mode,recipient_employee_id,recipient_employee_label
    ) values(
      v_review.workspace_id,
      case when v_destination='direct_project' then v_review.project_id else null end,
      v_warehouse,null,v_type,v_review.document_number,coalesce(v_review.document_date,current_date),'draft',
      v_review.document_id,v_invoice,v_group_key,v_destination,v_review.recipient_employee_id,v_review.recipient_employee_label
    ) returning id into v_movement;
  else
    update public.stock_movements set
      project_id=case when v_destination='direct_project' then v_review.project_id else null end,
      warehouse_id=v_warehouse,target_warehouse_id=null,movement_type=v_type,
      document_number=v_review.document_number,movement_date=coalesce(v_review.document_date,current_date),
      source_document_id=v_review.document_id,source_invoice_id=v_invoice,source_group_key=v_group_key,
      destination_mode=v_destination,recipient_employee_id=v_review.recipient_employee_id,
      recipient_employee_label=v_review.recipient_employee_label
    where id=v_movement and status='draft';
  end if;

  insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity,unit_cost,source_invoice_line_id)
  select l.workspace_id,v_movement,l.candidate_stock_item_id,l.quantity,
         case when v_type='PZ' then nullif(coalesce(l.normalized_unit_price,l.unit_price),0) else null end,
         case when v_type='PZ' then il.id else null end
  from public.warehouse_ai_lines l
  left join public.invoice_lines il on il.invoice_id=v_invoice and il.line_number=l.source_line_index
  where l.review_id=p_review_id
    and l.decision in('auto_matched','matched','new_item_created')
    and l.candidate_stock_item_id is not null and coalesce(l.quantity,0)>0;
  get diagnostics v_lines=row_count;

  if v_lines=0 then
    delete from public.stock_movements where id=v_movement and status='draft' and source_group_key=v_group_key;
    update public.warehouse_document_reviews set draft_movement_id=null where id=p_review_id;
    return null;
  end if;

  update public.warehouse_document_reviews
     set draft_movement_id=v_movement,
         invoice_id=case when v_type='PZ' then v_invoice else invoice_id end,
         updated_at=now()
   where id=p_review_id;

  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(v_review.workspace_id,v_review.project_id,p_actor_id,'warehouse.ai_draft_ready','stock_movement',v_movement::text,
    jsonb_build_object(
      'review_id',p_review_id,'source_document_index',v_review.source_document_index,'movement_type',v_type,
      'destinationMode',v_destination,'projectId',v_review.project_id,'recipientEmployeeId',v_review.recipient_employee_id,
      'lines',v_lines,'status','draft'
    ));
  return v_movement;
end;
$$;

revoke all on function private.create_warehouse_draft_for_review_31(uuid,uuid) from public,anon,authenticated;

create or replace function private.validate_material_movement_before_approval()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.status='approved' and old.status is distinct from new.status then
    if new.recipient_employee_id is not null and not exists(
      select 1 from public.employees e where e.id=new.recipient_employee_id and e.workspace_id=new.workspace_id
    ) then
      raise exception 'Odbiorca MM nie należy do aktywnej firmy.';
    end if;

    if upper(new.movement_type)='MM' then
      if new.destination_mode='direct_project' and new.project_id is null then
        raise exception 'MM na inwestycję wymaga rozpoznanej inwestycji.';
      elsif new.destination_mode='central_stock' and new.target_warehouse_id is null then
        raise exception 'MM magazyn-magazyn wymaga magazynu docelowego.';
      elsif new.destination_mode not in ('direct_project','central_stock') then
        raise exception 'MM wymaga inwestycji albo magazynu docelowego.';
      end if;
    end if;

    if upper(new.movement_type)='RW' and new.project_id is null then
      raise exception 'RW wymaga inwestycji, którą obciąży koszt materiału.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_material_movement_before_approval() from public;

drop trigger if exists stock_movement_material_flow_guard on public.stock_movements;
create trigger stock_movement_material_flow_guard
before update of status on public.stock_movements
for each row execute function private.validate_material_movement_before_approval();

create or replace function private.allocate_material_flow_fifo()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_out record;
  v_src record;
  v_remaining numeric;
  v_available numeric;
  v_take numeric;
  v_cost numeric;
  v_total_qty numeric;
  v_total_cost numeric;
  v_shortfall numeric := 0;
  v_il record;
  v_project_amount numeric;
  v_all_projects_amount numeric;
  v_inventory_amount numeric;
  v_existing uuid;
begin
  if not (new.status='approved' and old.status is distinct from new.status) then return new; end if;
  if upper(new.movement_type) not in ('MM','RW','WZ') or new.project_id is null then return new; end if;

  for v_out in
    select sml.*
    from public.stock_movement_lines sml
    where sml.workspace_id=new.workspace_id and sml.movement_id=new.id
    order by sml.id
  loop
    delete from public.stock_cost_allocations where outbound_movement_line_id=v_out.id;
    v_remaining := v_out.quantity;
    v_total_qty := 0;
    v_total_cost := 0;

    for v_src in
      select src.id,
             src.quantity,
             src.source_invoice_line_id,
             coalesce(src.unit_cost, il.net_amount/nullif(il.quantity,0), 0) as unit_cost,
             sm.approved_at, sm.movement_date,
             coalesce((select sum(a.quantity) from public.stock_cost_allocations a where a.source_movement_line_id=src.id),0) as allocated_qty
      from public.stock_movement_lines src
      join public.stock_movements sm on sm.id=src.movement_id
      left join public.invoice_lines il on il.id=src.source_invoice_line_id
      where src.workspace_id=new.workspace_id
        and src.stock_item_id=v_out.stock_item_id
        and sm.workspace_id=new.workspace_id
        and sm.status='approved'
        and upper(sm.movement_type)='PZ'
        and sm.warehouse_id=new.warehouse_id
        and sm.id<>new.id
        and coalesce(sm.movement_date,current_date)<=coalesce(new.movement_date,current_date)
      order by sm.movement_date, sm.approved_at, sm.created_at, src.id
    loop
      exit when v_remaining<=0.0000001;
      v_available := greatest(v_src.quantity-v_src.allocated_qty,0);
      if v_available<=0.0000001 then continue; end if;
      v_take := least(v_remaining,v_available);
      v_cost := greatest(coalesce(v_src.unit_cost,0),0);

      insert into public.stock_cost_allocations(
        workspace_id,outbound_movement_line_id,source_movement_line_id,source_invoice_line_id,project_id,
        quantity,unit_cost,costing_method
      ) values(
        new.workspace_id,v_out.id,v_src.id,v_src.source_invoice_line_id,new.project_id,v_take,v_cost,'fifo'
      )
      on conflict(outbound_movement_line_id,source_movement_line_id) do update set
        quantity=excluded.quantity,unit_cost=excluded.unit_cost,project_id=excluded.project_id,source_invoice_line_id=excluded.source_invoice_line_id;

      v_remaining := v_remaining-v_take;
      v_total_qty := v_total_qty+v_take;
      v_total_cost := v_total_cost+(v_take*v_cost);
    end loop;

    if v_total_qty>0 then
      update public.stock_movement_lines
         set unit_cost=round(v_total_cost/v_total_qty,6)
       where id=v_out.id;
    end if;
    if v_remaining>0.0000001 then v_shortfall:=v_shortfall+v_remaining; end if;
  end loop;

  for v_il in
    select distinct il.id,il.invoice_id,il.net_amount
    from public.stock_cost_allocations a
    join public.stock_movement_lines outl on outl.id=a.outbound_movement_line_id
    join public.stock_movements outm on outm.id=outl.movement_id
    join public.invoice_lines il on il.id=a.source_invoice_line_id
    where outm.id=new.id and a.source_invoice_line_id is not null
  loop
    select coalesce(sum(a.quantity*a.unit_cost),0) into v_project_amount
    from public.stock_cost_allocations a
    join public.stock_movement_lines outl on outl.id=a.outbound_movement_line_id
    join public.stock_movements outm on outm.id=outl.movement_id
    where a.source_invoice_line_id=v_il.id
      and outm.workspace_id=new.workspace_id
      and outm.project_id=new.project_id
      and outm.status='approved';

    select coalesce(sum(a.quantity*a.unit_cost),0) into v_all_projects_amount
    from public.stock_cost_allocations a
    join public.stock_movement_lines outl on outl.id=a.outbound_movement_line_id
    join public.stock_movements outm on outm.id=outl.movement_id
    where a.source_invoice_line_id=v_il.id
      and outm.workspace_id=new.workspace_id
      and outm.project_id is not null
      and outm.status='approved';

    select id into v_existing
    from public.financial_allocations
    where workspace_id=new.workspace_id
      and source_type='invoice'
      and source_line_id=v_il.id
      and project_id=new.project_id
      and status in ('proposed','approved')
    order by created_at desc limit 1;

    if v_existing is null then
      insert into public.financial_allocations(
        workspace_id,project_id,source_type,source_id,source_line_id,amount,allocation_percent,status,
        allocation_basis,allocation_scope,allocation_source
      ) values(
        new.workspace_id,new.project_id,'invoice',v_il.invoice_id,v_il.id,
        round(v_project_amount,2),
        case when coalesce(v_il.net_amount,0)>0 then least(100,round(100*v_project_amount/v_il.net_amount,4)) else null end,
        'approved','FIFO z zatwierdzonego MM/RW/WZ','project','automatic'
      );
    else
      update public.financial_allocations
         set amount=round(v_project_amount,2),
             allocation_percent=case when coalesce(v_il.net_amount,0)>0 then least(100,round(100*v_project_amount/v_il.net_amount,4)) else null end,
             allocation_basis='FIFO z zatwierdzonego MM/RW/WZ',
             allocation_scope='project',allocation_source='automatic',status='approved'
       where id=v_existing;
    end if;

    v_inventory_amount := greatest(coalesce(v_il.net_amount,0)-v_all_projects_amount,0);

    select id into v_existing
    from public.financial_allocations
    where workspace_id=new.workspace_id
      and source_type='invoice'
      and source_line_id=v_il.id
      and project_id is null
      and allocation_scope='inventory'
      and status in ('proposed','approved')
    order by created_at desc limit 1;

    if v_inventory_amount<=0.01 then
      if v_existing is not null then delete from public.financial_allocations where id=v_existing; end if;
    elsif v_existing is null then
      insert into public.financial_allocations(
        workspace_id,project_id,source_type,source_id,source_line_id,amount,allocation_percent,status,
        allocation_basis,allocation_scope,allocation_source
      ) values(
        new.workspace_id,null,'invoice',v_il.invoice_id,v_il.id,round(v_inventory_amount,2),
        case when coalesce(v_il.net_amount,0)>0 then least(100,round(100*v_inventory_amount/v_il.net_amount,4)) else null end,
        'approved','Pozostały zapas po wydaniach FIFO','inventory','automatic'
      );
    else
      update public.financial_allocations
         set amount=round(v_inventory_amount,2),
             allocation_percent=case when coalesce(v_il.net_amount,0)>0 then least(100,round(100*v_inventory_amount/v_il.net_amount,4)) else null end,
             allocation_basis='Pozostały zapas po wydaniach FIFO',
             allocation_scope='inventory',allocation_source='automatic',status='approved'
       where id=v_existing;
    end if;
  end loop;

  insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
  values(
    new.workspace_id,new.project_id,new.approved_by,'ai','warehouse.material_flow_fifo_allocated','stock_movement',new.id::text,
    jsonb_build_object(
      'movementType',new.movement_type,'projectId',new.project_id,'recipientEmployeeId',new.recipient_employee_id,
      'costingMethod','fifo','unpricedQuantity',v_shortfall
    )
  );

  return new;
end;
$$;

revoke all on function private.allocate_material_flow_fifo() from public;

drop trigger if exists stock_movement_material_flow_fifo on public.stock_movements;
create trigger stock_movement_material_flow_fifo
after update of status on public.stock_movements
for each row execute function private.allocate_material_flow_fifo();

create or replace function public.orchestrate_approved_business_documents_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_doc public.documents%rowtype;
  v_ext record;
  v_documents jsonb;
  v_business jsonb;
  v_idx integer;
  v_inbox uuid;
  v_process jsonb;
  v_invoice uuid;
  v_external_key text;
  v_source_channel text;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_type text;
  v_review uuid;
begin
  select * into v_doc
  from public.documents
  where id=p_document_id and workspace_id=p_workspace_id
  for update;
  if not found then raise exception 'Dokument nie należy do firmy.'; end if;

  select id,document_version_id,payload,confidence
    into v_ext
  from public.document_extractions
  where workspace_id=p_workspace_id and document_id=p_document_id
    and extraction_type='document_context' and status<>'rejected'
  order by created_at desc limit 1;
  if v_ext.id is null then raise exception 'Brak ekstrakcji biznesowej dokumentu.'; end if;

  if jsonb_typeof(v_ext.payload->'businessDocuments')='array'
     and jsonb_array_length(v_ext.payload->'businessDocuments')>0 then
    v_documents:=v_ext.payload->'businessDocuments';
  elsif jsonb_typeof(v_ext.payload->'businessDocument')='object' then
    v_documents:=jsonb_build_array(v_ext.payload->'businessDocument');
  else
    return jsonb_build_object('skipped',true,'reason','no_business_documents','count',0,'documents','[]'::jsonb);
  end if;

  v_source_channel:=coalesce(nullif(v_doc.metadata->>'source_channel',''),'upload');

  for v_business,v_idx in
    select value,ordinality::integer from jsonb_array_elements(v_documents) with ordinality
  loop
    v_type:=upper(trim(coalesce(v_business->>'documentType','')));

    if v_type<>'INVOICE' then
      select wr.id into v_review
      from public.warehouse_document_reviews wr
      where wr.workspace_id=p_workspace_id
        and wr.document_version_id=v_ext.document_version_id
        and wr.source_document_index=v_idx
      order by wr.created_at desc limit 1;

      v_count:=v_count+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'sourceDocumentIndex',v_idx,'documentType',v_type,'warehouseReviewId',v_review,
        'documentNumber',v_business->>'documentNumber','projectCode',v_business->>'projectCode',
        'recipientEmployeeName',v_business->>'recipientEmployeeName','invoiceId',null
      ));
      continue;
    end if;

    v_external_key:=p_document_id::text||':business:'||v_idx::text;
    insert into public.business_inbox_items(
      workspace_id,source_channel,external_key,document_id,project_id,document_type,status,
      payload,canonical_payload,canonical_version,received_at
    ) values(
      p_workspace_id,v_source_channel,v_external_key,null,v_doc.project_id,'invoice','processing',
      jsonb_build_object('confidence',v_ext.confidence,'sourceDocumentId',p_document_id,'sourceDocumentIndex',v_idx),
      v_business,'business-document-v3-material-flow',v_doc.created_at
    )
    on conflict(workspace_id,source_channel,external_key) do update set
      project_id=excluded.project_id,document_type='invoice',status='processing',payload=excluded.payload,
      canonical_payload=excluded.canonical_payload,canonical_version=excluded.canonical_version,
      processing_error=null,processed_at=null,
      document_id=case when public.business_inbox_items.invoice_id is null then null else public.business_inbox_items.document_id end
    returning id into v_inbox;

    v_process:=public.process_business_inbox_item_atomic(p_workspace_id,v_inbox,p_actor_id);
    if coalesce((v_process->>'ok')::boolean,false)=false then
      raise exception '%',coalesce(v_process->>'error','Orkiestracja faktury nie powiodła się.');
    end if;

    v_invoice:=public.octopus_uuid(v_process #>> '{result,invoiceId}');
    if v_invoice is not null then
      update public.invoices set document_id=p_document_id where id=v_invoice and workspace_id=p_workspace_id;
      update public.business_inbox_items set document_id=p_document_id,invoice_id=v_invoice where id=v_inbox;
      update public.stock_movements
        set source_document_id=p_document_id,
            document_number=coalesce(nullif(document_number,''),nullif(v_business->>'documentNumber',''))
      where workspace_id=p_workspace_id and source_invoice_id=v_invoice;
      update public.warehouse_document_reviews
        set invoice_id=v_invoice,updated_at=now()
      where workspace_id=p_workspace_id and document_version_id=v_ext.document_version_id and source_document_index=v_idx;
    end if;

    v_count:=v_count+1;
    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'sourceDocumentIndex',v_idx,'documentType','INVOICE','invoiceId',v_invoice,
      'documentNumber',v_business->>'documentNumber','supplierName',v_business->>'supplierName',
      'lineCount',jsonb_array_length(case when jsonb_typeof(v_business->'lines')='array' then v_business->'lines' else '[]'::jsonb end)
    ));
  end loop;

  return jsonb_build_object('skipped',v_count=0,'count',v_count,'documents',v_results,'documentId',p_document_id);
end;
$$;

revoke all on function public.orchestrate_approved_business_documents_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.orchestrate_approved_business_documents_atomic(uuid,uuid,uuid) to service_role;

comment on table public.stock_cost_allocations is
  'FIFO provenance: outgoing material line -> inbound PZ line -> source invoice line. Used to move purchase cost from inventory to project when MM/RW/WZ is approved.';
