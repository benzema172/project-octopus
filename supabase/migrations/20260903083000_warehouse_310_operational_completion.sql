begin;

-- Warehouse 3.1 — Operational Completion
-- Additive, AI-first and safe: no physical stock changes without an approved movement.

alter table public.warehouse_document_reviews
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists document_direction text,
  add column if not exists document_date date,
  add column if not exists source_line_count integer not null default 0,
  add column if not exists draft_movement_id uuid references public.stock_movements(id) on delete set null;

create index if not exists warehouse_document_reviews_project_idx
  on public.warehouse_document_reviews(workspace_id, project_id, updated_at desc)
  where project_id is not null;
create index if not exists warehouse_document_reviews_draft_movement_idx
  on public.warehouse_document_reviews(draft_movement_id)
  where draft_movement_id is not null;

create table if not exists public.warehouse_ai_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  normalized_description text not null,
  supplier_key text not null default '',
  supplier_sku text,
  candidate_stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  feedback text not null check (feedback in ('accepted','rejected')),
  hit_count integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists warehouse_ai_feedback_identity_uidx
  on public.warehouse_ai_feedback(workspace_id, normalized_description, supplier_key, candidate_stock_item_id, feedback);
create index if not exists warehouse_ai_feedback_lookup_idx
  on public.warehouse_ai_feedback(workspace_id, normalized_description, supplier_key, feedback, updated_at desc);

create table if not exists public.warehouse_ai_decision_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ai_line_id uuid not null references public.warehouse_ai_lines(id) on delete cascade,
  before_decision text not null,
  before_candidate_stock_item_id uuid references public.stock_items(id) on delete set null,
  before_match_confidence numeric(5,4),
  before_reason text,
  after_decision text not null,
  after_candidate_stock_item_id uuid references public.stock_items(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reverted_at timestamptz
);
create index if not exists warehouse_ai_decision_events_line_idx
  on public.warehouse_ai_decision_events(workspace_id, ai_line_id, created_at desc);

create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  parent_id uuid references public.warehouse_locations(id) on delete cascade,
  code text not null,
  name text not null,
  qr_token text not null default encode(gen_random_bytes(9), 'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, warehouse_id, code),
  unique(workspace_id, qr_token)
);
create index if not exists warehouse_locations_parent_idx
  on public.warehouse_locations(workspace_id, warehouse_id, parent_id, active, code);

create table if not exists public.stock_item_location_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  warehouse_location_id uuid not null references public.warehouse_locations(id) on delete cascade,
  preferred boolean not null default false,
  created_at timestamptz not null default now(),
  unique(stock_item_id, warehouse_location_id)
);
create index if not exists stock_item_location_assignments_workspace_idx
  on public.stock_item_location_assignments(workspace_id, warehouse_location_id, stock_item_id);

alter table public.warehouse_ai_feedback enable row level security;
alter table public.warehouse_ai_decision_events enable row level security;
alter table public.warehouse_locations enable row level security;
alter table public.stock_item_location_assignments enable row level security;

drop policy if exists warehouse_ai_feedback_read on public.warehouse_ai_feedback;
create policy warehouse_ai_feedback_read on public.warehouse_ai_feedback for select to authenticated
  using(private.has_domain_access(workspace_id,'warehouse','read',null));
drop policy if exists warehouse_ai_feedback_write on public.warehouse_ai_feedback;
create policy warehouse_ai_feedback_write on public.warehouse_ai_feedback for all to authenticated
  using(private.has_domain_access(workspace_id,'warehouse','write',null))
  with check(private.has_domain_access(workspace_id,'warehouse','write',null));

drop policy if exists warehouse_ai_decision_events_read on public.warehouse_ai_decision_events;
create policy warehouse_ai_decision_events_read on public.warehouse_ai_decision_events for select to authenticated
  using(private.has_domain_access(workspace_id,'warehouse','read',null));
drop policy if exists warehouse_ai_decision_events_write on public.warehouse_ai_decision_events;
create policy warehouse_ai_decision_events_write on public.warehouse_ai_decision_events for all to authenticated
  using(private.has_domain_access(workspace_id,'warehouse','write',null))
  with check(private.has_domain_access(workspace_id,'warehouse','write',null));

drop policy if exists warehouse_locations_read on public.warehouse_locations;
create policy warehouse_locations_read on public.warehouse_locations for select to authenticated
  using(private.has_domain_access(workspace_id,'warehouse','read',null));
drop policy if exists warehouse_locations_write on public.warehouse_locations;
create policy warehouse_locations_write on public.warehouse_locations for all to authenticated
  using(private.has_domain_access(workspace_id,'warehouse','write',null))
  with check(private.has_domain_access(workspace_id,'warehouse','write',null));

drop policy if exists stock_item_location_assignments_read on public.stock_item_location_assignments;
create policy stock_item_location_assignments_read on public.stock_item_location_assignments for select to authenticated
  using(private.has_domain_access(workspace_id,'warehouse','read',null));
drop policy if exists stock_item_location_assignments_write on public.stock_item_location_assignments;
create policy stock_item_location_assignments_write on public.stock_item_location_assignments for all to authenticated
  using(private.has_domain_access(workspace_id,'warehouse','write',null))
  with check(private.has_domain_access(workspace_id,'warehouse','write',null));

grant select,insert,update,delete on public.warehouse_ai_feedback to authenticated,service_role;
grant select,insert,update,delete on public.warehouse_ai_decision_events to authenticated,service_role;
grant select,insert,update,delete on public.warehouse_locations to authenticated,service_role;
grant select,insert,update,delete on public.stock_item_location_assignments to authenticated,service_role;

create or replace function private.try_numeric(p_value text)
returns numeric
language plpgsql
immutable
set search_path=pg_catalog
as $$
declare v numeric;
begin
  if p_value is null or btrim(p_value)='' then return null; end if;
  begin
    v := replace(btrim(p_value),',','.')::numeric;
  exception when others then
    return null;
  end;
  return v;
end;$$;

create or replace function private.prepare_warehouse_review_31()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_source_module text;
  v_document_name text;
  v_expected integer:=0;
  v_date_text text;
  v_document_date date;
begin
  if new.extraction_type<>'document_context' then return new; end if;

  select nullif(di.source_metadata->>'sourceModule','')
    into v_source_module
  from public.document_intakes di
  where di.document_id=new.document_id
  limit 1;
  if coalesce(v_source_module,'')<>'warehouse' then return new; end if;

  select count(*)::integer into v_expected
  from jsonb_array_elements(coalesce(new.payload #> '{businessDocument,lines}','[]'::jsonb)) value
  where btrim(coalesce(value->>'description',''))<>'';
  if v_expected=0 then v_expected:=1; end if;

  v_date_text:=nullif(new.payload #>> '{businessDocument,issueDate}','');
  if v_date_text ~ '^\d{4}-\d{2}-\d{2}$' then
    begin v_document_date:=v_date_text::date; exception when others then v_document_date:=null; end;
  end if;
  select dv.file_name into v_document_name from public.document_versions dv where dv.id=new.document_version_id;

  insert into public.warehouse_document_reviews(
    workspace_id,document_id,document_version_id,project_id,source_module,
    document_type,document_number,document_direction,document_date,
    supplier_name,supplier_tax_id,document_name,ai_summary,confidence,source_line_count,status,updated_at
  ) values(
    new.workspace_id,new.document_id,new.document_version_id,new.project_id,v_source_module,
    nullif(new.payload #>> '{businessDocument,documentType}',''),
    nullif(new.payload #>> '{businessDocument,documentNumber}',''),
    nullif(lower(new.payload #>> '{businessDocument,direction}'),''),v_document_date,
    nullif(new.payload #>> '{businessDocument,supplierName}',''),
    nullif(new.payload #>> '{businessDocument,supplierTaxId}',''),v_document_name,
    nullif(new.payload->>'summary',''),coalesce(new.confidence,0),v_expected,'waiting',now()
  ) on conflict(document_version_id) do update set
    project_id=excluded.project_id,
    document_direction=excluded.document_direction,
    document_date=excluded.document_date,
    source_line_count=excluded.source_line_count,
    updated_at=now();
  return new;
end;$$;

drop trigger if exists warehouse_00_prepare_review_31 on public.document_extractions;
create trigger warehouse_00_prepare_review_31
  before insert or update of payload on public.document_extractions
  for each row
  when(new.extraction_type='document_context')
  execute function private.prepare_warehouse_review_31();

create or replace function private.enhance_warehouse_ai_line_identity_31()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_line jsonb;
  v_review public.warehouse_document_reviews%rowtype;
  v_supplier_key text:='';
  v_candidate uuid;
  v_feedback uuid;
  v_ean text;
  v_manufacturer text;
  v_model text;
  v_normalized_price numeric;
begin
  if new.line_class not in ('material','device','tool','spare_part','consumable') then return new; end if;
  select * into v_review from public.warehouse_document_reviews where id=new.review_id;
  if found then v_supplier_key:=public.normalize_material_key(coalesce(v_review.supplier_name,'')); end if;

  select de.payload #> array['businessDocument','lines',(new.source_line_index-1)::text]
    into v_line
  from public.document_extractions de
  where de.document_version_id=new.document_version_id and de.extraction_type='document_context'
  order by de.created_at desc limit 1;

  v_ean:=nullif(coalesce(v_line->>'ean',v_line->>'barcode',new.ean),'');
  v_manufacturer:=nullif(coalesce(v_line->>'manufacturer',new.manufacturer),'');
  v_model:=nullif(coalesce(v_line->>'model',new.model),'');
  v_normalized_price:=coalesce(
    private.try_numeric(v_line->>'normalizedUnitPrice'),
    private.try_numeric(v_line->>'unitPricePerBaseUnit'),
    new.normalized_unit_price,
    new.unit_price
  );
  new.ean:=v_ean;
  new.manufacturer:=v_manufacturer;
  new.model:=v_model;
  new.normalized_unit_price:=v_normalized_price;

  if new.candidate_stock_item_id is not null then
    select f.id into v_feedback
    from public.warehouse_ai_feedback f
    where f.workspace_id=new.workspace_id
      and f.normalized_description=new.normalized_description
      and f.candidate_stock_item_id=new.candidate_stock_item_id
      and f.feedback='rejected'
      and (f.supplier_key='' or f.supplier_key=v_supplier_key)
    order by f.updated_at desc limit 1;
    if v_feedback is not null then
      new.candidate_stock_item_id:=null;
      new.match_confidence:=0;
      new.decision:='needs_review';
      new.decision_reason:='Ta kartoteka była wcześniej odrzucona dla tej pozycji. AI nie powtarza błędnej sugestii.';
    end if;
  end if;

  if new.candidate_stock_item_id is null then
    select f.candidate_stock_item_id into v_candidate
    from public.warehouse_ai_feedback f
    join public.stock_items si on si.id=f.candidate_stock_item_id and si.active
    where f.workspace_id=new.workspace_id
      and f.normalized_description=new.normalized_description
      and f.feedback='accepted'
      and (f.supplier_key='' or f.supplier_key=v_supplier_key)
    order by f.hit_count desc,f.updated_at desc limit 1;
    if v_candidate is not null then
      new.candidate_stock_item_id:=v_candidate;
      new.match_confidence:=0.995;
      new.decision:='auto_matched';
      new.decision_reason:='Dopasowano na podstawie wcześniejszej potwierdzonej decyzji użytkownika.';
    end if;
  end if;

  if new.candidate_stock_item_id is null and v_ean is not null then
    select si.id into v_candidate from public.stock_items si
    where si.workspace_id=new.workspace_id and si.active and si.barcode=v_ean limit 1;
    if v_candidate is not null then
      new.candidate_stock_item_id:=v_candidate;new.match_confidence:=0.999;new.decision:='auto_matched';
      new.decision_reason:='Jednoznaczne dopasowanie po EAN/kodzie kreskowym.';
    end if;
  end if;

  if new.candidate_stock_item_id is null and new.supplier_sku is not null then
    select si.id into v_candidate from public.stock_items si
    where si.workspace_id=new.workspace_id and si.active and si.sku=new.supplier_sku limit 1;
    if v_candidate is not null then
      new.candidate_stock_item_id:=v_candidate;new.match_confidence:=0.995;new.decision:='auto_matched';
      new.decision_reason:='Jednoznaczne dopasowanie po SKU/indeksie produktu.';
    end if;
  end if;

  if new.candidate_stock_item_id is null and v_manufacturer is not null and v_model is not null then
    select si.id into v_candidate from public.stock_items si
    where si.workspace_id=new.workspace_id and si.active
      and public.normalize_material_key(coalesce(si.manufacturer,''))=public.normalize_material_key(v_manufacturer)
      and public.normalize_material_key(coalesce(si.model,''))=public.normalize_material_key(v_model)
    order by si.updated_at desc limit 1;
    if v_candidate is not null then
      new.candidate_stock_item_id:=v_candidate;new.match_confidence:=0.97;new.decision:='auto_matched';
      new.decision_reason:='Dopasowano po producencie i modelu.';
    end if;
  end if;

  return new;
end;$$;

drop trigger if exists warehouse_ai_lines_identity_31 on public.warehouse_ai_lines;
create trigger warehouse_ai_lines_identity_31
  before insert on public.warehouse_ai_lines
  for each row execute function private.enhance_warehouse_ai_line_identity_31();

create or replace function private.recalc_warehouse_document_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_total integer;v_stock integer;v_review integer;v_non_stock integer;
  v_expected integer;v_status text;
begin
  select source_line_count into v_expected from public.warehouse_document_reviews where id=p_review_id;
  select count(*),
    count(*) filter(where decision in('auto_matched','matched','new_item_created')),
    count(*) filter(where decision in('needs_review','new_item_proposed')),
    count(*) filter(where decision in('non_stock','rejected'))
  into v_total,v_stock,v_review,v_non_stock
  from public.warehouse_ai_lines where review_id=p_review_id;

  v_status:=case
    when coalesce(v_total,0)<greatest(coalesce(v_expected,0),1) then 'waiting'
    when coalesce(v_review,0)>0 then 'waiting'
    when coalesce(v_stock,0)>0 then 'warehouse'
    else 'waiting'
  end;
  update public.warehouse_document_reviews set
    total_lines=coalesce(v_total,0),stock_lines=coalesce(v_stock,0),review_lines=coalesce(v_review,0),non_stock_lines=coalesce(v_non_stock,0),
    status=case when status='ignored' then 'ignored' else v_status end,updated_at=now()
  where id=p_review_id;
end;$$;

create or replace function private.create_warehouse_draft_for_review_31(p_review_id uuid,p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_review public.warehouse_document_reviews%rowtype;
  v_warehouse uuid;v_movement uuid;v_invoice uuid;v_type text;v_lines integer;v_existing_status text;
begin
  select * into v_review from public.warehouse_document_reviews where id=p_review_id for update;
  if not found or v_review.status<>'warehouse' then return null; end if;
  if exists(select 1 from public.warehouse_ai_lines where review_id=p_review_id and decision in('needs_review','new_item_proposed')) then return null; end if;
  if (select count(*) from public.warehouse_ai_lines where review_id=p_review_id)<greatest(v_review.source_line_count,1) then return null; end if;

  if v_review.draft_movement_id is not null then
    select status into v_existing_status from public.stock_movements where id=v_review.draft_movement_id;
    if v_existing_status is not null and v_existing_status<>'draft' then return v_review.draft_movement_id; end if;
    if v_existing_status='draft' then
      delete from public.stock_movement_lines where movement_id=v_review.draft_movement_id;
      v_movement:=v_review.draft_movement_id;
    end if;
  end if;

  if v_movement is null then
    select sm.id into v_movement from public.stock_movements sm
    where sm.workspace_id=v_review.workspace_id and sm.source_document_id=v_review.document_id
    order by case when sm.status='draft' then 0 else 1 end,sm.created_at desc limit 1;
    if v_movement is not null then
      update public.warehouse_document_reviews set draft_movement_id=v_movement where id=p_review_id;
      select status into v_existing_status from public.stock_movements where id=v_movement;
      if v_existing_status<>'draft' then return v_movement; end if;
      delete from public.stock_movement_lines where movement_id=v_movement;
    end if;
  end if;

  select id into v_warehouse from public.warehouses
  where workspace_id=v_review.workspace_id and active
  order by case when warehouse_type='central' then 0 else 1 end,created_at limit 1;
  if v_warehouse is null then
    insert into public.warehouses(workspace_id,name,warehouse_type,active)
    values(v_review.workspace_id,'Magazyn główny','central',true) returning id into v_warehouse;
  end if;
  select id into v_invoice from public.invoices where workspace_id=v_review.workspace_id and document_id=v_review.document_id order by created_at desc limit 1;
  v_type:=case when lower(coalesce(v_review.document_direction,'')) in('sale','outgoing','outbound','issue','sales') then 'WZ' else 'PZ' end;

  if v_movement is null then
    insert into public.stock_movements(workspace_id,project_id,warehouse_id,movement_type,document_number,movement_date,status,source_document_id,source_invoice_id,source_group_key,destination_mode)
    values(v_review.workspace_id,v_review.project_id,v_warehouse,v_type,v_review.document_number,coalesce(v_review.document_date,current_date),'draft',v_review.document_id,v_invoice,'warehouse-ai-31',case when v_type='PZ' then 'central_stock' when v_review.project_id is not null then 'direct_project' else 'unassigned' end)
    returning id into v_movement;
  else
    update public.stock_movements set
      project_id=v_review.project_id,warehouse_id=v_warehouse,movement_type=v_type,document_number=v_review.document_number,
      movement_date=coalesce(v_review.document_date,current_date),source_invoice_id=v_invoice,source_group_key='warehouse-ai-31'
    where id=v_movement and status='draft';
  end if;

  insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity,unit_cost,source_invoice_line_id)
  select l.workspace_id,v_movement,l.candidate_stock_item_id,l.quantity,
         coalesce(l.normalized_unit_price,l.unit_price),il.id
  from public.warehouse_ai_lines l
  left join public.invoice_lines il on il.invoice_id=v_invoice and il.line_number=l.source_line_index
  where l.review_id=p_review_id
    and l.decision in('auto_matched','matched','new_item_created')
    and l.candidate_stock_item_id is not null and coalesce(l.quantity,0)>0;
  get diagnostics v_lines=row_count;
  if v_lines=0 then
    delete from public.stock_movements where id=v_movement and status='draft' and source_group_key='warehouse-ai-31';
    update public.warehouse_document_reviews set draft_movement_id=null where id=p_review_id;
    return null;
  end if;

  update public.warehouse_document_reviews set draft_movement_id=v_movement,updated_at=now() where id=p_review_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(v_review.workspace_id,v_review.project_id,p_actor_id,'warehouse.ai_draft_ready','stock_movement',v_movement::text,
    jsonb_build_object('review_id',p_review_id,'movement_type',v_type,'lines',v_lines,'status','draft'));
  return v_movement;
end;$$;

create or replace function public.finalize_warehouse_review_atomic(p_workspace_id uuid,p_review_id uuid,p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  perform 1 from public.warehouse_document_reviews where id=p_review_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Dokument nie należy do aktywnej firmy.'; end if;
  return private.create_warehouse_draft_for_review_31(p_review_id,p_actor_id);
end;$$;

create or replace function private.auto_create_warehouse_draft_trigger_31()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
begin
  if new.status='warehouse' and old.status is distinct from new.status and new.draft_movement_id is null then
    perform private.create_warehouse_draft_for_review_31(new.id,null);
  end if;
  return new;
end;$$;
drop trigger if exists warehouse_review_auto_draft_31 on public.warehouse_document_reviews;
create trigger warehouse_review_auto_draft_31
  after update of status on public.warehouse_document_reviews
  for each row execute function private.auto_create_warehouse_draft_trigger_31();

create or replace function private.capture_warehouse_ai_price()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  v_review public.warehouse_document_reviews%rowtype;v_counterparty uuid;v_price numeric;
begin
  if new.decision not in('auto_matched','matched','new_item_created') or new.candidate_stock_item_id is null then return new; end if;
  v_price:=coalesce(new.normalized_unit_price,new.unit_price);
  if v_price is null or v_price<=0 then return new; end if;
  select * into v_review from public.warehouse_document_reviews where id=new.review_id;
  if not found then return new; end if;
  if v_review.supplier_tax_id is not null then
    select id into v_counterparty from public.counterparties where workspace_id=new.workspace_id and tax_id=v_review.supplier_tax_id order by active desc,created_at desc limit 1;
  end if;
  if v_counterparty is null and v_review.supplier_name is not null then
    select id into v_counterparty from public.counterparties where workspace_id=new.workspace_id and public.normalize_material_key(name)=public.normalize_material_key(v_review.supplier_name) order by active desc,created_at desc limit 1;
  end if;
  insert into public.price_observations(workspace_id,project_id,stock_item_id,counterparty_id,source_type,source_id,observed_at,quantity,unit,unit_price_net,currency,price_stage,canonical_purchase)
  values(new.workspace_id,v_review.project_id,new.candidate_stock_item_id,v_counterparty,'warehouse_ai_line',new.id,coalesce(v_review.document_date,current_date),new.quantity,new.unit,v_price,coalesce(new.currency,'PLN'),'document_ai',false)
  on conflict(workspace_id,source_type,source_id) do update set
    project_id=excluded.project_id,stock_item_id=excluded.stock_item_id,counterparty_id=excluded.counterparty_id,observed_at=excluded.observed_at,
    quantity=excluded.quantity,unit=excluded.unit,unit_price_net=excluded.unit_price_net,currency=excluded.currency,price_stage=excluded.price_stage;
  return new;
end;$$;
drop trigger if exists warehouse_ai_lines_capture_price on public.warehouse_ai_lines;
create trigger warehouse_ai_lines_capture_price
  after insert or update of decision,candidate_stock_item_id,unit_price,normalized_unit_price on public.warehouse_ai_lines
  for each row execute function private.capture_warehouse_ai_price();

create or replace function public.create_manual_stock_movement_atomic(
  p_workspace_id uuid,p_movement_type text,p_warehouse_id uuid,p_target_warehouse_id uuid,p_project_id uuid,
  p_document_number text,p_movement_date date,p_lines jsonb,p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare
  v_type text:=upper(btrim(coalesce(p_movement_type,'')));v_id uuid;v_line jsonb;v_item uuid;v_qty numeric;v_cost numeric;v_count integer:=0;
begin
  if v_type not in('PZ','WZ','RW','ZW','MM') then raise exception 'Nieobsługiwany typ ruchu.'; end if;
  perform 1 from public.warehouses where id=p_warehouse_id and workspace_id=p_workspace_id and active;
  if not found then raise exception 'Magazyn źródłowy nie należy do aktywnej firmy.'; end if;
  if v_type='MM' then
    perform 1 from public.warehouses where id=p_target_warehouse_id and workspace_id=p_workspace_id and active;
    if not found or p_target_warehouse_id=p_warehouse_id then raise exception 'Wskaż inny aktywny magazyn docelowy.'; end if;
  end if;
  if p_project_id is not null then
    perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;
    if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.'; end if;
  end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' then raise exception 'Pozycje ruchu są nieprawidłowe.'; end if;
  insert into public.stock_movements(workspace_id,project_id,warehouse_id,target_warehouse_id,movement_type,document_number,movement_date,status,source_group_key,destination_mode)
  values(p_workspace_id,p_project_id,p_warehouse_id,case when v_type='MM' then p_target_warehouse_id else null end,v_type,nullif(btrim(coalesce(p_document_number,'')),''),coalesce(p_movement_date,current_date),'draft','manual-31',case when v_type in('PZ','ZW','MM') then 'central_stock' when p_project_id is not null then 'direct_project' else 'unassigned' end)
  returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin v_item:=(v_line->>'stockItemId')::uuid; exception when others then v_item:=null; end;
    v_qty:=private.try_numeric(v_line->>'quantity');v_cost:=private.try_numeric(v_line->>'unitCost');
    perform 1 from public.stock_items where id=v_item and workspace_id=p_workspace_id and active;
    if not found or coalesce(v_qty,0)<=0 then continue; end if;
    insert into public.stock_movement_lines(workspace_id,movement_id,stock_item_id,quantity,unit_cost)
    values(p_workspace_id,v_id,v_item,v_qty,case when coalesce(v_cost,0)>=0 then v_cost else null end);
    v_count:=v_count+1;
  end loop;
  if v_count=0 then delete from public.stock_movements where id=v_id;raise exception 'Dodaj co najmniej jedną prawidłową pozycję ruchu.';end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'warehouse.manual_draft_created','stock_movement',v_id::text,jsonb_build_object('movement_type',v_type,'lines',v_count));
  return v_id;
end;$$;

create or replace function public.merge_stock_items_atomic(p_workspace_id uuid,p_source_id uuid,p_target_id uuid,p_actor_id uuid)
returns uuid
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare
  v_source public.stock_items%rowtype;v_target public.stock_items%rowtype;
begin
  if p_source_id=p_target_id then raise exception 'Nie można scalić kartoteki z nią samą.';end if;
  select * into v_source from public.stock_items where id=p_source_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Kartoteka źródłowa nie istnieje.';end if;
  select * into v_target from public.stock_items where id=p_target_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Kartoteka docelowa nie istnieje.';end if;

  -- release unique identifiers before moving them to the canonical target
  update public.stock_items set sku=null,barcode=null where id=p_source_id;
  update public.stock_items set
    sku=coalesce(sku,v_source.sku),barcode=coalesce(barcode,v_source.barcode),manufacturer=coalesce(manufacturer,v_source.manufacturer),
    model=coalesce(model,v_source.model),category=coalesce(category,v_source.category),subcategory=coalesce(subcategory,v_source.subcategory),
    minimum_stock=greatest(minimum_stock,v_source.minimum_stock),optimal_stock=greatest(optimal_stock,v_source.optimal_stock),
    serial_tracking=serial_tracking or v_source.serial_tracking,warranty_months=coalesce(warranty_months,v_source.warranty_months),updated_at=now()
  where id=p_target_id;

  delete from public.material_aliases s using public.material_aliases t
  where s.stock_item_id=p_source_id and t.stock_item_id=p_target_id and s.workspace_id=p_workspace_id and t.workspace_id=p_workspace_id
    and coalesce(s.counterparty_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(t.counterparty_id,'00000000-0000-0000-0000-000000000000'::uuid)
    and s.normalized_key=t.normalized_key and coalesce(s.supplier_sku,'')=coalesce(t.supplier_sku,'');
  update public.material_aliases set stock_item_id=p_target_id where workspace_id=p_workspace_id and stock_item_id=p_source_id;
  insert into public.material_aliases(workspace_id,stock_item_id,supplier_sku,supplier_name,normalized_key,confidence,status,created_by)
  values(p_workspace_id,p_target_id,v_source.sku,null,public.normalize_material_key(v_source.name),1,'approved',p_actor_id)
  on conflict do nothing;

  update public.inventory_count_lines t set
    system_quantity=t.system_quantity+s.system_quantity,
    counted_quantity=case when t.counted_quantity is null and s.counted_quantity is null then null else coalesce(t.counted_quantity,0)+coalesce(s.counted_quantity,0) end,
    difference=case when t.counted_quantity is null and s.counted_quantity is null then null else coalesce(t.counted_quantity,0)+coalesce(s.counted_quantity,0)-(t.system_quantity+s.system_quantity) end,
    updated_at=now()
  from public.inventory_count_lines s
  where t.inventory_count_id=s.inventory_count_id and t.stock_item_id=p_target_id and s.stock_item_id=p_source_id;
  delete from public.inventory_count_lines s using public.inventory_count_lines t
  where s.inventory_count_id=t.inventory_count_id and s.stock_item_id=p_source_id and t.stock_item_id=p_target_id;
  update public.inventory_count_lines set stock_item_id=p_target_id where stock_item_id=p_source_id;

  delete from public.stock_item_location_assignments s using public.stock_item_location_assignments t
  where s.stock_item_id=p_source_id and t.stock_item_id=p_target_id and s.warehouse_location_id=t.warehouse_location_id;
  update public.stock_item_location_assignments set stock_item_id=p_target_id where stock_item_id=p_source_id;

  update public.stock_movement_lines set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.reservations set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.stock_item_instances set stock_item_id=p_target_id,updated_at=now() where stock_item_id=p_source_id;
  update public.price_observations set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.warehouse_ai_lines set candidate_stock_item_id=p_target_id where candidate_stock_item_id=p_source_id;
  update public.purchase_order_lines set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.invoice_lines set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.material_chain_events set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.material_requests set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.procurement_traces set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.inventory_cost_layers set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.tool_service_events set stock_item_id=p_target_id where stock_item_id=p_source_id;
  update public.warehouse_ai_feedback set candidate_stock_item_id=p_target_id,updated_at=now() where candidate_stock_item_id=p_source_id;

  update public.stock_items set active=false,updated_at=now() where id=p_source_id;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_actor_id,'warehouse.stock_item_merged','stock_item',p_source_id::text,jsonb_build_object('source_name',v_source.name),jsonb_build_object('target_id',p_target_id,'target_name',v_target.name));
  return p_target_id;
end;$$;

create or replace function public.create_replenishment_order_atomic(
  p_workspace_id uuid,p_stock_item_id uuid,p_quantity numeric,p_counterparty_id uuid,p_project_id uuid,p_actor_id uuid
) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp
as $$
declare
  v_item public.stock_items%rowtype;v_order uuid;v_number text;v_price numeric;v_currency text:='PLN';
begin
  select * into v_item from public.stock_items where id=p_stock_item_id and workspace_id=p_workspace_id and active;
  if not found then raise exception 'Kartoteka nie należy do aktywnej firmy.';end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'Ilość zamówienia musi być większa od zera.';end if;
  if p_counterparty_id is not null then perform 1 from public.counterparties where id=p_counterparty_id and workspace_id=p_workspace_id and active;if not found then raise exception 'Dostawca nie należy do aktywnej firmy.';end if;end if;
  if p_project_id is not null then perform 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id;if not found then raise exception 'Inwestycja nie należy do aktywnej firmy.';end if;end if;
  select unit_price_net,currency into v_price,v_currency from public.price_observations where workspace_id=p_workspace_id and stock_item_id=p_stock_item_id order by observed_at desc,created_at desc limit 1;
  v_number:='AI-ZAM-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISSMS');
  insert into public.purchase_orders(workspace_id,project_id,counterparty_id,order_number,status,currency,total_amount,notes,created_by,destination_mode)
  values(p_workspace_id,p_project_id,p_counterparty_id,v_number,'draft',coalesce(v_currency,'PLN'),coalesce(v_price,0)*p_quantity,'Szkic uzupełnienia wygenerowany z Magazynu 3.1',p_actor_id,case when p_project_id is null then 'central_stock' else 'direct_project' end)
  returning id into v_order;
  insert into public.purchase_order_lines(workspace_id,purchase_order_id,stock_item_id,description,quantity,unit,unit_price,total_amount)
  values(p_workspace_id,v_order,p_stock_item_id,v_item.name,p_quantity,v_item.unit,v_price,coalesce(v_price,0)*p_quantity);
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'warehouse.replenishment_draft_created','purchase_order',v_order::text,jsonb_build_object('stock_item_id',p_stock_item_id,'quantity',p_quantity));
  return v_order;
end;$$;

revoke all on function public.finalize_warehouse_review_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_warehouse_review_atomic(uuid,uuid,uuid) to service_role;
revoke all on function public.create_manual_stock_movement_atomic(uuid,text,uuid,uuid,uuid,text,date,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_manual_stock_movement_atomic(uuid,text,uuid,uuid,uuid,text,date,jsonb,uuid) to service_role;
revoke all on function public.merge_stock_items_atomic(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.merge_stock_items_atomic(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.create_replenishment_order_atomic(uuid,uuid,numeric,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_replenishment_order_atomic(uuid,uuid,numeric,uuid,uuid,uuid) to service_role;

insert into public.app_schema_versions(version)
values('20260903_warehouse_310_operational_completion')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
