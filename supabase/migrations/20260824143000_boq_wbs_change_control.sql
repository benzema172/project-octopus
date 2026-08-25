-- BOQ / WBS Change Control
-- Controlled draft revisions, line-level diff, WBS editing and Change Order decisions.

alter table public.boq_versions
  add column if not exists based_on_version_id uuid references public.boq_versions(id) on delete set null,
  add column if not exists change_order_id uuid references public.change_orders(id) on delete set null,
  add column if not exists revision_kind text not null default 'baseline',
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.boq_versions drop constraint if exists boq_versions_revision_kind_check;
alter table public.boq_versions add constraint boq_versions_revision_kind_check
  check (revision_kind in ('baseline','revision','change_order','corrective','as_built'));

alter table public.boq_items
  add column if not exists lineage_id uuid,
  add column if not exists is_active boolean not null default true,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.boq_items set lineage_id=gen_random_uuid() where lineage_id is null;
alter table public.boq_items alter column lineage_id set default gen_random_uuid();
alter table public.boq_items alter column lineage_id set not null;

alter table public.wbs_nodes
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.change_orders
  add column if not exists impact_summary jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists decided_by uuid references auth.users(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text,
  add column if not exists approved_boq_version_id uuid references public.boq_versions(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.boq_version_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  boq_version_id uuid not null references public.boq_versions(id) on delete cascade,
  lineage_id uuid not null,
  source_boq_item_id uuid references public.boq_items(id) on delete set null,
  item_number text,
  description text not null,
  unit text,
  quantity numeric(18,4),
  unit_price numeric(18,4),
  total_price numeric(18,2),
  wbs_node_id uuid references public.wbs_nodes(id) on delete set null,
  cost_code text,
  change_order_id uuid references public.change_orders(id) on delete set null,
  change_type text not null default 'unchanged',
  revision_note text,
  source_document_id uuid references public.documents(id) on delete set null,
  source_reference_id uuid references public.source_references(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(boq_version_id,lineage_id),
  check (change_type in ('unchanged','added','modified','removed')),
  check (quantity is null or quantity >= 0),
  check (unit_price is null or unit_price >= 0)
);

alter table public.boq_version_items enable row level security;
drop policy if exists boq_version_items_read on public.boq_version_items;
create policy boq_version_items_read on public.boq_version_items
for select to authenticated
using (public.has_domain_access(workspace_id,'investments','read',project_id));

revoke all on table public.boq_version_items from public,anon,authenticated;
grant select on table public.boq_version_items to authenticated;
grant all on table public.boq_version_items to service_role;

create unique index if not exists boq_items_project_lineage_uidx
  on public.boq_items(project_id,lineage_id);
create index if not exists boq_items_active_version_idx
  on public.boq_items(project_id,is_active,boq_version_id);
create index if not exists boq_versions_control_idx
  on public.boq_versions(workspace_id,project_id,status,version_number desc);
create index if not exists boq_versions_based_on_idx
  on public.boq_versions(based_on_version_id) where based_on_version_id is not null;
create index if not exists boq_versions_change_order_idx
  on public.boq_versions(change_order_id) where change_order_id is not null;
create index if not exists boq_version_items_version_idx
  on public.boq_version_items(workspace_id,project_id,boq_version_id,change_type);
create index if not exists boq_version_items_wbs_idx
  on public.boq_version_items(wbs_node_id) where wbs_node_id is not null;
create index if not exists boq_version_items_change_order_idx
  on public.boq_version_items(change_order_id) where change_order_id is not null;
create index if not exists change_orders_control_idx
  on public.change_orders(workspace_id,project_id,status,created_at desc);
create index if not exists change_orders_approved_boq_idx
  on public.change_orders(approved_boq_version_id) where approved_boq_version_id is not null;

-- Full (non-partial) FK indexes are intentional: the migration contract and the
-- PostgreSQL planner must be able to use them for cascades even when a value is null.
create index if not exists boq_items_created_by_fk_idx on public.boq_items(created_by);
create index if not exists boq_versions_based_on_full_fk_idx on public.boq_versions(based_on_version_id);
create index if not exists boq_versions_change_order_full_fk_idx on public.boq_versions(change_order_id);
create index if not exists boq_versions_created_by_fk_idx on public.boq_versions(created_by);
create index if not exists boq_versions_submitted_by_fk_idx on public.boq_versions(submitted_by);
create index if not exists boq_version_items_source_boq_fk_idx on public.boq_version_items(source_boq_item_id);
create index if not exists boq_version_items_wbs_full_fk_idx on public.boq_version_items(wbs_node_id);
create index if not exists boq_version_items_change_order_full_fk_idx on public.boq_version_items(change_order_id);
create index if not exists boq_version_items_source_document_fk_idx on public.boq_version_items(source_document_id);
create index if not exists boq_version_items_source_reference_fk_idx on public.boq_version_items(source_reference_id);
create index if not exists boq_version_items_created_by_fk_idx on public.boq_version_items(created_by);
create index if not exists change_orders_created_by_fk_idx on public.change_orders(created_by);
create index if not exists change_orders_submitted_by_fk_idx on public.change_orders(submitted_by);
create index if not exists change_orders_decided_by_fk_idx on public.change_orders(decided_by);
create index if not exists change_orders_approved_boq_full_fk_idx on public.change_orders(approved_boq_version_id);
create index if not exists wbs_nodes_created_by_fk_idx on public.wbs_nodes(created_by);

-- Complete earlier AI proposal FK coverage while the chain is being hardened.
create index if not exists document_module_proposals_source_reference_full_fk_idx on public.document_module_proposals(source_reference_id);
create index if not exists document_module_proposals_created_by_full_fk_idx on public.document_module_proposals(created_by);
create index if not exists document_module_proposals_decided_by_full_fk_idx on public.document_module_proposals(decided_by);
create index if not exists estimate_import_rows_source_proposal_full_fk_idx on public.estimate_import_rows(source_proposal_id);

-- Preserve a snapshot for already versioned BOQ rows without duplicating the live BOQ.
insert into public.boq_version_items(
  workspace_id,project_id,boq_version_id,lineage_id,source_boq_item_id,item_number,
  description,unit,quantity,unit_price,total_price,wbs_node_id,cost_code,
  change_type,source_document_id,source_reference_id,created_by
)
select
  coalesce(b.workspace_id,v.workspace_id),b.project_id,b.boq_version_id,b.lineage_id,b.id,
  coalesce(b.item_number,b.item_no),b.description,b.unit,b.quantity,b.unit_price,
  coalesce(b.total_price,b.total_value),b.wbs_node_id,b.cost_code,'unchanged',
  b.source_document_id,b.source_reference_id,b.created_by
from public.boq_items b
join public.boq_versions v on v.id=b.boq_version_id
where b.boq_version_id is not null
on conflict(boq_version_id,lineage_id) do nothing;

create or replace function public.guard_boq_version_item_mutation()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_version_id uuid; v_status text;
begin
  v_version_id:=coalesce(new.boq_version_id,old.boq_version_id);
  select status into v_status from public.boq_versions where id=v_version_id;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft BOQ version can be edited' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists guard_boq_version_item_mutation on public.boq_version_items;
create trigger guard_boq_version_item_mutation
before insert or update or delete on public.boq_version_items
for each row execute function public.guard_boq_version_item_mutation();

create or replace function public.create_boq_revision_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_based_on_version_id uuid,
  p_name text,
  p_revision_kind text,
  p_change_order_id uuid,
  p_actor_id uuid
)
returns table(result_version_id uuid,result_version_number integer,result_item_count integer)
language plpgsql security invoker set search_path=public as $$
declare
  v_version_id uuid;
  v_version_number integer;
  v_item_count integer:=0;
  v_kind text:=lower(trim(coalesce(p_revision_kind,'revision')));
  v_name text:=trim(coalesce(p_name,''));
begin
  if v_name='' then raise exception 'BOQ version name is required' using errcode='22023'; end if;
  if v_kind not in ('baseline','revision','change_order','corrective','as_built') then
    raise exception 'Unsupported BOQ revision kind' using errcode='22023';
  end if;
  if not exists(select 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id) then
    raise exception 'Project does not belong to workspace' using errcode='42501';
  end if;
  if p_based_on_version_id is not null and not exists(
    select 1 from public.boq_versions where id=p_based_on_version_id and workspace_id=p_workspace_id and project_id=p_project_id
  ) then raise exception 'Base BOQ version does not belong to project' using errcode='42501'; end if;
  if p_change_order_id is not null and not exists(
    select 1 from public.change_orders where id=p_change_order_id and workspace_id=p_workspace_id and project_id=p_project_id and status<>'rejected'
  ) then raise exception 'Change Order does not belong to project or is rejected' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended('boq-version:'||p_project_id::text,0));
  select coalesce(max(version_number),0)+1 into v_version_number from public.boq_versions where project_id=p_project_id;
  insert into public.boq_versions(
    workspace_id,project_id,version_number,name,status,currency,net_value,based_on_version_id,
    change_order_id,revision_kind,created_by,updated_at
  ) values(
    p_workspace_id,p_project_id,v_version_number,v_name,'draft','PLN',0,p_based_on_version_id,
    p_change_order_id,v_kind,p_actor_id,now()
  ) returning id into v_version_id;

  if p_based_on_version_id is not null and exists(select 1 from public.boq_version_items where boq_version_id=p_based_on_version_id) then
    insert into public.boq_version_items(
      workspace_id,project_id,boq_version_id,lineage_id,source_boq_item_id,item_number,description,
      unit,quantity,unit_price,total_price,wbs_node_id,cost_code,change_order_id,change_type,
      revision_note,source_document_id,source_reference_id,created_by
    )
    select p_workspace_id,p_project_id,v_version_id,lineage_id,source_boq_item_id,item_number,description,
      unit,quantity,unit_price,total_price,wbs_node_id,cost_code,null,'unchanged',null,
      source_document_id,source_reference_id,p_actor_id
    from public.boq_version_items where boq_version_id=p_based_on_version_id and change_type<>'removed';
  else
    insert into public.boq_version_items(
      workspace_id,project_id,boq_version_id,lineage_id,source_boq_item_id,item_number,description,
      unit,quantity,unit_price,total_price,wbs_node_id,cost_code,change_order_id,change_type,
      source_document_id,source_reference_id,created_by
    )
    select p_workspace_id,p_project_id,v_version_id,b.lineage_id,b.id,coalesce(b.item_number,b.item_no),b.description,
      b.unit,b.quantity,b.unit_price,coalesce(b.total_price,b.total_value),b.wbs_node_id,b.cost_code,
      null,'unchanged',b.source_document_id,b.source_reference_id,p_actor_id
    from public.boq_items b where b.project_id=p_project_id and b.is_active=true;
  end if;

  get diagnostics v_item_count=row_count;
  update public.boq_versions set net_value=coalesce((select sum(coalesce(total_price,0)) from public.boq_version_items where boq_version_id=v_version_id and change_type<>'removed'),0),updated_at=now() where id=v_version_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'boq_version.created','boq_version',v_version_id::text,
    jsonb_build_object('version_number',v_version_number,'based_on_version_id',p_based_on_version_id,'change_order_id',p_change_order_id,'revision_kind',v_kind,'items',v_item_count));
  return query select v_version_id,v_version_number,v_item_count;
end;
$$;

create or replace function public.save_boq_revision_item_atomic(
  p_workspace_id uuid,
  p_project_id uuid,
  p_boq_version_id uuid,
  p_item_id uuid,
  p_item_number text,
  p_description text,
  p_unit text,
  p_quantity numeric,
  p_unit_price numeric,
  p_wbs_node_id uuid,
  p_cost_code text,
  p_change_order_id uuid,
  p_revision_note text,
  p_actor_id uuid
)
returns table(result_item_id uuid,result_total_price numeric,result_change_type text)
language plpgsql security invoker set search_path=public as $$
declare
  v_item public.boq_version_items%rowtype;
  v_item_id uuid;
  v_total numeric(18,2);
  v_change_type text;
  v_description text:=trim(coalesce(p_description,''));
begin
  if v_description='' then raise exception 'BOQ item description is required' using errcode='22023'; end if;
  if coalesce(p_quantity,0)<0 or coalesce(p_unit_price,0)<0 then raise exception 'Quantity and price cannot be negative' using errcode='22023'; end if;
  if not exists(select 1 from public.boq_versions where id=p_boq_version_id and workspace_id=p_workspace_id and project_id=p_project_id and status='draft') then
    raise exception 'Only a project draft BOQ version can be edited' using errcode='55000';
  end if;
  if p_wbs_node_id is not null and not exists(select 1 from public.wbs_nodes where id=p_wbs_node_id and workspace_id=p_workspace_id and project_id=p_project_id) then
    raise exception 'WBS node does not belong to project' using errcode='42501';
  end if;
  if p_change_order_id is not null and not exists(select 1 from public.change_orders where id=p_change_order_id and workspace_id=p_workspace_id and project_id=p_project_id and status<>'rejected') then
    raise exception 'Change Order does not belong to project or is rejected' using errcode='42501';
  end if;
  v_total:=round(coalesce(p_quantity,0)*coalesce(p_unit_price,0),2);

  if p_item_id is null then
    insert into public.boq_version_items(
      workspace_id,project_id,boq_version_id,lineage_id,item_number,description,unit,quantity,
      unit_price,total_price,wbs_node_id,cost_code,change_order_id,change_type,revision_note,created_by
    ) values(
      p_workspace_id,p_project_id,p_boq_version_id,gen_random_uuid(),nullif(trim(coalesce(p_item_number,'')),''),v_description,
      nullif(trim(coalesce(p_unit,'')),''),p_quantity,p_unit_price,v_total,p_wbs_node_id,
      nullif(trim(coalesce(p_cost_code,'')),''),p_change_order_id,'added',nullif(trim(coalesce(p_revision_note,'')),''),p_actor_id
    ) returning id,change_type into v_item_id,v_change_type;
  else
    select * into v_item from public.boq_version_items
      where id=p_item_id and boq_version_id=p_boq_version_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
    if not found then raise exception 'BOQ draft item does not belong to version' using errcode='42501'; end if;
    v_change_type:=case when v_item.change_type='added' then 'added' else 'modified' end;
    update public.boq_version_items set
      item_number=nullif(trim(coalesce(p_item_number,'')),''),description=v_description,
      unit=nullif(trim(coalesce(p_unit,'')),''),quantity=p_quantity,unit_price=p_unit_price,total_price=v_total,
      wbs_node_id=p_wbs_node_id,cost_code=nullif(trim(coalesce(p_cost_code,'')),''),change_order_id=p_change_order_id,
      change_type=v_change_type,revision_note=nullif(trim(coalesce(p_revision_note,'')),''),updated_at=now()
    where id=v_item.id returning id into v_item_id;
  end if;

  update public.boq_versions set net_value=coalesce((select sum(coalesce(total_price,0)) from public.boq_version_items where boq_version_id=p_boq_version_id and change_type<>'removed'),0),updated_at=now() where id=p_boq_version_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'boq_version_item.saved','boq_version_item',v_item_id::text,
    case when p_item_id is null then null else to_jsonb(v_item) end,
    jsonb_build_object('boq_version_id',p_boq_version_id,'item_number',p_item_number,'description',v_description,'quantity',p_quantity,'unit_price',p_unit_price,'total_price',v_total,'change_type',v_change_type));
  return query select v_item_id,v_total,v_change_type;
end;
$$;

create or replace function public.remove_boq_revision_item_atomic(
  p_workspace_id uuid,p_project_id uuid,p_boq_version_id uuid,p_item_id uuid,p_actor_id uuid
)
returns table(result_item_id uuid,result_change_type text)
language plpgsql security invoker set search_path=public as $$
declare v_item public.boq_version_items%rowtype; v_result text;
begin
  if not exists(select 1 from public.boq_versions where id=p_boq_version_id and workspace_id=p_workspace_id and project_id=p_project_id and status='draft') then
    raise exception 'Only a project draft BOQ version can be edited' using errcode='55000';
  end if;
  select * into v_item from public.boq_version_items where id=p_item_id and boq_version_id=p_boq_version_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
  if not found then raise exception 'BOQ draft item does not belong to version' using errcode='42501'; end if;
  if v_item.change_type='added' then delete from public.boq_version_items where id=v_item.id; v_result:='deleted';
  else update public.boq_version_items set change_type='removed',updated_at=now() where id=v_item.id; v_result:='removed'; end if;
  update public.boq_versions set net_value=coalesce((select sum(coalesce(total_price,0)) from public.boq_version_items where boq_version_id=p_boq_version_id and change_type<>'removed'),0),updated_at=now() where id=p_boq_version_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'boq_version_item.removed','boq_version_item',p_item_id::text,to_jsonb(v_item),jsonb_build_object('result',v_result));
  return query select p_item_id,v_result;
end;
$$;

create or replace function public.submit_boq_version_atomic(
  p_workspace_id uuid,p_project_id uuid,p_boq_version_id uuid,p_actor_id uuid
)
returns table(result_version_id uuid,result_status text)
language plpgsql security invoker set search_path=public as $$
declare v_version public.boq_versions%rowtype;
begin
  select * into v_version from public.boq_versions where id=p_boq_version_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
  if not found then raise exception 'BOQ version does not belong to project' using errcode='42501'; end if;
  if v_version.status='review' then return query select v_version.id,v_version.status; return; end if;
  if v_version.status<>'draft' then raise exception 'Only a draft BOQ version can be submitted' using errcode='55000'; end if;
  if not exists(select 1 from public.boq_version_items where boq_version_id=v_version.id and change_type<>'removed') then
    raise exception 'BOQ version must contain at least one active item' using errcode='22023';
  end if;
  update public.boq_versions set status='review',submitted_by=p_actor_id,submitted_at=now(),updated_at=now() where id=v_version.id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'boq_version.submitted','boq_version',v_version.id::text,jsonb_build_object('status',v_version.status),jsonb_build_object('status','review'));
  return query select v_version.id,'review'::text;
end;
$$;

create or replace function public.approve_boq_version_atomic(
  p_workspace_id uuid,p_project_id uuid,p_boq_version_id uuid,p_actor_id uuid,p_note text default null
)
returns table(result_version_id uuid,result_status text,result_net_value numeric,result_active_items integer)
language plpgsql security invoker set search_path=public as $$
declare
  v_version public.boq_versions%rowtype;
  v_net numeric(18,2);
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('boq-approve:'||p_project_id::text,0));
  select * into v_version from public.boq_versions where id=p_boq_version_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
  if not found then raise exception 'BOQ version does not belong to project' using errcode='42501'; end if;
  if v_version.status='approved' then
    select coalesce(sum(coalesce(total_price,0)),0),count(*) into v_net,v_count from public.boq_version_items where boq_version_id=v_version.id and change_type<>'removed';
    return query select v_version.id,v_version.status,v_net,v_count; return;
  end if;
  if v_version.status<>'review' then raise exception 'BOQ version must be submitted before approval' using errcode='55000'; end if;
  if exists(select 1 from public.boq_version_items where boq_version_id=v_version.id and change_type<>'removed' and trim(description)='') then
    raise exception 'BOQ contains an item without description' using errcode='22023';
  end if;

  update public.boq_items b set
    workspace_id=p_workspace_id,boq_version_id=v_version.id,item_number=i.item_number,item_no=i.item_number,
    description=i.description,unit=i.unit,quantity=i.quantity,unit_price=i.unit_price,
    total_price=i.total_price,total_value=i.total_price,wbs_node_id=i.wbs_node_id,cost_code=i.cost_code,
    source_document_id=coalesce(i.source_document_id,b.source_document_id),source_reference_id=coalesce(i.source_reference_id,b.source_reference_id),
    is_active=true,updated_at=now()
  from public.boq_version_items i
  where i.boq_version_id=v_version.id and i.change_type<>'removed' and b.project_id=p_project_id and b.lineage_id=i.lineage_id;

  insert into public.boq_items(
    workspace_id,project_id,boq_version_id,lineage_id,item_number,item_no,description,unit,quantity,unit_price,
    total_price,total_value,wbs_node_id,cost_code,source_document_id,source_reference_id,is_active,created_by,created_at,updated_at
  )
  select p_workspace_id,p_project_id,v_version.id,i.lineage_id,i.item_number,i.item_number,i.description,i.unit,i.quantity,i.unit_price,
    i.total_price,i.total_price,i.wbs_node_id,i.cost_code,i.source_document_id,i.source_reference_id,true,p_actor_id,now(),now()
  from public.boq_version_items i
  where i.boq_version_id=v_version.id and i.change_type<>'removed'
    and not exists(select 1 from public.boq_items b where b.project_id=p_project_id and b.lineage_id=i.lineage_id);

  update public.boq_items b set is_active=false,updated_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('retired_by_boq_version',v_version.id)
  where b.project_id=p_project_id and b.is_active=true and not exists(
    select 1 from public.boq_version_items i where i.boq_version_id=v_version.id and i.lineage_id=b.lineage_id and i.change_type<>'removed'
  );

  select coalesce(sum(coalesce(total_price,0)),0),count(*) into v_net,v_count
  from public.boq_version_items where boq_version_id=v_version.id and change_type<>'removed';
  update public.boq_versions set status='superseded',updated_at=now()
    where workspace_id=p_workspace_id and project_id=p_project_id and status='approved' and id<>v_version.id;
  update public.boq_versions set status='approved',net_value=v_net,approved_by=p_actor_id,approved_at=now(),notes=coalesce(nullif(trim(p_note),''),notes),updated_at=now()
    where id=v_version.id;
  if v_version.change_order_id is not null then
    update public.change_orders set status='approved',approved_boq_version_id=v_version.id,decided_by=p_actor_id,decided_at=now(),decision_note=coalesce(nullif(trim(p_note),''),decision_note),updated_at=now()
      where id=v_version.change_order_id and workspace_id=p_workspace_id and project_id=p_project_id;
  end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'boq_version.approved','boq_version',v_version.id::text,to_jsonb(v_version),jsonb_build_object('status','approved','net_value',v_net,'active_items',v_count,'change_order_id',v_version.change_order_id));
  return query select v_version.id,'approved'::text,v_net,v_count;
end;
$$;

create or replace function public.upsert_wbs_node_atomic(
  p_workspace_id uuid,p_project_id uuid,p_wbs_node_id uuid,p_parent_id uuid,p_code text,p_name text,
  p_branch text,p_installation text,p_zone text,p_sort_order integer,p_actor_id uuid
)
returns table(result_wbs_node_id uuid,result_status text)
language plpgsql security invoker set search_path=public as $$
declare v_id uuid; v_before public.wbs_nodes%rowtype; v_code text:=trim(coalesce(p_code,'')); v_name text:=trim(coalesce(p_name,''));
begin
  if v_code='' or v_name='' then raise exception 'WBS code and name are required' using errcode='22023'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id) then raise exception 'Project does not belong to workspace' using errcode='42501'; end if;
  if p_parent_id is not null and not exists(select 1 from public.wbs_nodes where id=p_parent_id and workspace_id=p_workspace_id and project_id=p_project_id) then raise exception 'Parent WBS node does not belong to project' using errcode='42501'; end if;
  if p_wbs_node_id is null then
    insert into public.wbs_nodes(workspace_id,project_id,parent_id,code,name,branch,installation,zone,sort_order,status,created_by,updated_at)
    values(p_workspace_id,p_project_id,p_parent_id,v_code,v_name,nullif(trim(coalesce(p_branch,'')),''),nullif(trim(coalesce(p_installation,'')),''),nullif(trim(coalesce(p_zone,'')),''),coalesce(p_sort_order,0),'active',p_actor_id,now()) returning id into v_id;
  else
    select * into v_before from public.wbs_nodes where id=p_wbs_node_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
    if not found then raise exception 'WBS node does not belong to project' using errcode='42501'; end if;
    if p_parent_id=p_wbs_node_id then raise exception 'WBS node cannot be its own parent' using errcode='22023'; end if;
    update public.wbs_nodes set parent_id=p_parent_id,code=v_code,name=v_name,branch=nullif(trim(coalesce(p_branch,'')),''),installation=nullif(trim(coalesce(p_installation,'')),''),zone=nullif(trim(coalesce(p_zone,'')),''),sort_order=coalesce(p_sort_order,0),updated_at=now() where id=p_wbs_node_id returning id into v_id;
  end if;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,case when p_wbs_node_id is null then 'wbs_node.created' else 'wbs_node.updated' end,'wbs_node',v_id::text,case when p_wbs_node_id is null then null else to_jsonb(v_before) end,jsonb_build_object('code',v_code,'name',v_name,'parent_id',p_parent_id));
  return query select v_id,'active'::text;
end;
$$;

create or replace function public.create_change_order_controlled_atomic(
  p_workspace_id uuid,p_project_id uuid,p_number text,p_title text,p_description text,
  p_value_change numeric,p_days_change integer,p_actor_id uuid
)
returns table(result_change_order_id uuid,result_status text)
language plpgsql security invoker set search_path=public as $$
declare v_id uuid; v_title text:=trim(coalesce(p_title,'')); v_number text:=nullif(trim(coalesce(p_number,'')),'');
begin
  if v_title='' then raise exception 'Change Order title is required' using errcode='22023'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and workspace_id=p_workspace_id) then raise exception 'Project does not belong to workspace' using errcode='42501'; end if;
  if v_number is not null and exists(select 1 from public.change_orders where project_id=p_project_id and lower(number)=lower(v_number)) then raise exception 'Change Order number already exists in project' using errcode='23505'; end if;
  insert into public.change_orders(workspace_id,project_id,number,title,description,status,value_change,days_change,created_by,impact_summary,updated_at)
  values(p_workspace_id,p_project_id,v_number,v_title,nullif(trim(coalesce(p_description,'')),''),'identified',p_value_change,p_days_change,p_actor_id,jsonb_build_object('value_change',p_value_change,'days_change',p_days_change),now()) returning id into v_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'change_order.created','change_order',v_id::text,jsonb_build_object('number',v_number,'title',v_title,'value_change',p_value_change,'days_change',p_days_change));
  return query select v_id,'identified'::text;
end;
$$;

create or replace function public.review_change_order_atomic(
  p_workspace_id uuid,p_project_id uuid,p_change_order_id uuid,p_action text,p_actor_id uuid,p_note text default null
)
returns table(result_change_order_id uuid,result_status text)
language plpgsql security invoker set search_path=public as $$
declare v_order public.change_orders%rowtype; v_action text:=lower(trim(coalesce(p_action,''))); v_next text;
begin
  select * into v_order from public.change_orders where id=p_change_order_id and workspace_id=p_workspace_id and project_id=p_project_id for update;
  if not found then raise exception 'Change Order does not belong to project' using errcode='42501'; end if;
  if v_action='submit' and v_order.status in ('identified','draft') then v_next:='submitted';
  elsif v_action='approve' and v_order.status='submitted' then v_next:='approved';
  elsif v_action='reject' and v_order.status='submitted' then v_next:='rejected';
  elsif v_action='reopen' and v_order.status='rejected' then v_next:='identified';
  elsif (v_action='submit' and v_order.status='submitted')
     or (v_action='approve' and v_order.status='approved')
     or (v_action='reject' and v_order.status='rejected')
     or (v_action='reopen' and v_order.status='identified') then
    return query select v_order.id,v_order.status; return;
  else raise exception 'Unsupported Change Order transition from % using %',v_order.status,v_action using errcode='55000'; end if;
  update public.change_orders set status=v_next,
    submitted_by=case when v_next='submitted' then p_actor_id else submitted_by end,
    submitted_at=case when v_next='submitted' then now() else submitted_at end,
    decided_by=case when v_next in ('approved','rejected') then p_actor_id when v_next='identified' then null else decided_by end,
    decided_at=case when v_next in ('approved','rejected') then now() when v_next='identified' then null else decided_at end,
    decision_note=case when v_next in ('approved','rejected') then nullif(trim(coalesce(p_note,'')),'') when v_next='identified' then null else decision_note end,
    updated_at=now() where id=v_order.id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,before_value,after_value)
  values(p_workspace_id,p_project_id,p_actor_id,'change_order.'||v_action,'change_order',v_order.id::text,jsonb_build_object('status',v_order.status),jsonb_build_object('status',v_next,'note',nullif(trim(coalesce(p_note,'')),'')));
  return query select v_order.id,v_next;
end;
$$;

revoke all on function public.guard_boq_version_item_mutation() from public,anon,authenticated;
grant execute on function public.guard_boq_version_item_mutation() to service_role;
revoke all on function public.create_boq_revision_atomic(uuid,uuid,uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_boq_revision_atomic(uuid,uuid,uuid,text,text,uuid,uuid) to service_role;
revoke all on function public.save_boq_revision_item_atomic(uuid,uuid,uuid,uuid,text,text,text,numeric,numeric,uuid,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.save_boq_revision_item_atomic(uuid,uuid,uuid,uuid,text,text,text,numeric,numeric,uuid,text,uuid,text,uuid) to service_role;
revoke all on function public.remove_boq_revision_item_atomic(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.remove_boq_revision_item_atomic(uuid,uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.submit_boq_version_atomic(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.submit_boq_version_atomic(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.approve_boq_version_atomic(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.approve_boq_version_atomic(uuid,uuid,uuid,uuid,text) to service_role;
revoke all on function public.upsert_wbs_node_atomic(uuid,uuid,uuid,uuid,text,text,text,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.upsert_wbs_node_atomic(uuid,uuid,uuid,uuid,text,text,text,text,text,integer,uuid) to service_role;
revoke all on function public.create_change_order_controlled_atomic(uuid,uuid,text,text,text,numeric,integer,uuid) from public,anon,authenticated;
grant execute on function public.create_change_order_controlled_atomic(uuid,uuid,text,text,text,numeric,integer,uuid) to service_role;
revoke all on function public.review_change_order_atomic(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.review_change_order_atomic(uuid,uuid,uuid,text,uuid,text) to service_role;

insert into public.app_schema_versions(version)
values('2026-08-24-boq-wbs-change-control')
on conflict do nothing;
