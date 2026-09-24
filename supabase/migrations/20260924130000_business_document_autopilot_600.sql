-- Business Document Autopilot 6.0
-- Finance Wrzutnia uses the business-document specialist and warehouse routing.
-- Physical stock is auto-approved only when the source document is approved,
-- AI/material matches are high-confidence, routing is unambiguous and stock guards pass.

do $migration$
declare
  v_def text;
  v_old text := 'if coalesce(v_source_module,'''') <> ''warehouse'' then return new; end if;';
  v_new text := 'if coalesce(v_source_module,'''') not in (''warehouse'',''finance'') then return new; end if;';
begin
  select pg_get_functiondef('private.resolve_warehouse_document_extraction()'::regprocedure) into v_def;
  if position(v_old in v_def) > 0 then
    execute replace(v_def,v_old,v_new);
  elsif position(v_new in v_def) = 0 then
    raise exception 'Nie znaleziono warunku sourceModule w resolve_warehouse_document_extraction.';
  end if;
end;
$migration$;

create or replace function private.resolve_active_warehouse_label_600(
  p_workspace_id uuid,
  p_label text
)
returns uuid
language plpgsql
stable
security definer
set search_path = 'public','private','pg_temp'
as $function$
declare
  v_key text := public.normalize_material_key(coalesce(p_label,''));
  v_ids uuid[];
begin
  if v_key = '' then return null; end if;
  select array_agg(w.id order by w.created_at,w.id)
    into v_ids
  from public.warehouses w
  where w.workspace_id=p_workspace_id
    and w.active
    and (
      public.normalize_material_key(coalesce(w.name,''))=v_key
      or public.normalize_material_key(coalesce(w.location,''))=v_key
    );
  if cardinality(v_ids)=1 then return v_ids[1]; end if;
  return null;
end;
$function$;

revoke all on function private.resolve_active_warehouse_label_600(uuid,text) from public,anon,authenticated;

do $migration$
declare
  v_def text;
  v_old text := 'if v_type not in (''PZ'',''WZ'',''RW'',''ZW'',''MM'') then raise exception ''Nieobsługiwany typ ruchu: %.'', v_type; end if;';

  v_new text := v_old || E'\n  if v_type = ''MM'' and (v_m.target_warehouse_id is null or v_m.target_warehouse_id = v_m.warehouse_id) then\n    raise exception ''MM wymaga innego magazynu docelowego.'';\n  end if;';
begin
  select pg_get_functiondef('public.approve_stock_movement_atomic(uuid,uuid,uuid)'::regprocedure) into v_def;
  if position('MM wymaga innego magazynu docelowego.' in v_def)=0 then
    if position(v_old in v_def)=0 then
      raise exception 'Nie znaleziono walidacji typu w approve_stock_movement_atomic.';
    end if;
    execute replace(v_def,v_old,v_new);
  end if;
end;
$migration$;

create or replace function private.try_auto_approve_warehouse_review_600(p_review_id uuid)
returns text
language plpgsql
security definer
set search_path = 'public','private','pg_temp'
as $function$
declare
  v_review public.warehouse_document_reviews%rowtype;
  v_movement public.stock_movements%rowtype;
  v_movement_id uuid;
  v_actor uuid;
  v_review_status text;
  v_type text;
  v_source_label text;
  v_target_label text;
  v_source_warehouse uuid;
  v_target_warehouse uuid;
begin
  select * into v_review
  from public.warehouse_document_reviews
  where id=p_review_id
  for update;
  if not found then return 'missing_review'; end if;
  if v_review.status <> 'warehouse' then return 'review_pending'; end if;

  select d.review_status,coalesce(d.approved_by,d.created_by)
    into v_review_status,v_actor
  from public.documents d
  where d.id=v_review.document_id and d.workspace_id=v_review.workspace_id;

  if coalesce(v_review_status,'') <> 'approved' then return 'document_not_approved'; end if;
  if v_actor is null then return 'missing_actor'; end if;
  if coalesce(v_review.confidence,0) < 0.90 then return 'low_document_confidence'; end if;

  if exists(
    select 1 from public.warehouse_ai_lines l
    where l.review_id=v_review.id
      and (
        l.decision in ('needs_review','new_item_proposed')
        or (
          l.decision in ('auto_matched','matched','new_item_created')
          and coalesce(l.match_confidence,0) < 0.90
        )
      )
  ) then return 'line_review_required'; end if;

  v_movement_id:=v_review.draft_movement_id;
  if v_movement_id is null then
    v_movement_id:=private.create_warehouse_draft_for_review_31(v_review.id,v_actor);
  end if;
  if v_movement_id is null then return 'no_safe_draft'; end if;

  select * into v_movement
  from public.stock_movements
  where id=v_movement_id and workspace_id=v_review.workspace_id
  for update;
  if not found then return 'missing_movement'; end if;
  if v_movement.status <> 'draft' then return 'already_finalized'; end if;

  v_type:=upper(trim(coalesce(v_review.document_type,v_movement.movement_type,'')));

  if v_type='PZ' then
    update public.stock_movements
       set destination_mode='central_stock',project_id=null,counterparty_id=null
     where id=v_movement.id;
  elsif v_type='ZW' then
    update public.stock_movements
       set destination_mode='central_stock',project_id=null,counterparty_id=null
     where id=v_movement.id;
  elsif v_type in ('WZ','RW') then
    if v_review.project_id is null or coalesce(v_review.project_match_confidence,0)<0.90 then
      return 'project_route_review_required';
    end if;
    update public.stock_movements
       set destination_mode='direct_project',project_id=v_review.project_id,counterparty_id=null
     where id=v_movement.id;
  elsif v_type='MM' then
    v_source_label:=nullif(trim(v_review.material_flow_metadata->>'sourceWarehouse'),'');
    v_target_label:=nullif(trim(v_review.material_flow_metadata->>'targetWarehouse'),'');
    v_source_warehouse:=private.resolve_active_warehouse_label_600(v_review.workspace_id,v_source_label);
    v_target_warehouse:=private.resolve_active_warehouse_label_600(v_review.workspace_id,v_target_label);
    if v_source_warehouse is null or v_target_warehouse is null or v_source_warehouse=v_target_warehouse then
      return 'warehouse_route_review_required';
    end if;
    update public.stock_movements
       set warehouse_id=v_source_warehouse,target_warehouse_id=v_target_warehouse,
           destination_mode='central_stock',project_id=null,counterparty_id=null
     where id=v_movement.id;
  else
    return 'unsupported_movement_type';
  end if;

  begin
    perform public.approve_stock_movement_atomic(v_review.workspace_id,v_movement.id,v_actor);
    insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
    values(
      v_review.workspace_id,
      case when v_type in ('WZ','RW') then v_review.project_id else null end,
      v_actor,'system','warehouse.business_document_auto_approved','stock_movement',v_movement.id::text,
      jsonb_build_object('reviewId',v_review.id,'documentId',v_review.document_id,'movementType',v_type,'confidence',v_review.confidence,'policy','guarded-600')
    );
    return 'approved';
  exception when others then
    insert into public.audit_events(workspace_id,project_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
    values(
      v_review.workspace_id,v_review.project_id,v_actor,'system','warehouse.business_document_auto_blocked','stock_movement',v_movement.id::text,
      jsonb_build_object('reviewId',v_review.id,'documentId',v_review.document_id,'movementType',v_type,'reason',sqlerrm,'policy','guarded-600')
    );
    return 'blocked:'||sqlerrm;
  end;
end;
$function$;

revoke all on function private.try_auto_approve_warehouse_review_600(uuid) from public,anon,authenticated;

create or replace function private.warehouse_review_autopilot_trigger_600()
returns trigger
language plpgsql
security definer
set search_path = 'public','private','pg_temp'
as $function$
begin
  if new.draft_movement_id is not null
     and old.draft_movement_id is distinct from new.draft_movement_id then
    perform private.try_auto_approve_warehouse_review_600(new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists zz_warehouse_review_autopilot_600 on public.warehouse_document_reviews;
create trigger zz_warehouse_review_autopilot_600
after update of draft_movement_id on public.warehouse_document_reviews
for each row execute function private.warehouse_review_autopilot_trigger_600();

create or replace function private.documents_business_autopilot_trigger_600()
returns trigger
language plpgsql
security definer
set search_path = 'public','private','pg_temp'
as $function$
declare
  v_review record;
begin
  if new.review_status='approved' and old.review_status is distinct from new.review_status then
    for v_review in
      select id from public.warehouse_document_reviews
      where workspace_id=new.workspace_id and document_id=new.id
      order by source_document_index,id
    loop
      perform private.try_auto_approve_warehouse_review_600(v_review.id);
    end loop;
  end if;
  return new;
end;
$function$;

drop trigger if exists zz_documents_business_autopilot_600 on public.documents;
create trigger zz_documents_business_autopilot_600
after update of review_status on public.documents
for each row execute function private.documents_business_autopilot_trigger_600();

comment on function private.try_auto_approve_warehouse_review_600(uuid) is
'Guarded business-document autopilot: approves only approved-source, >=90% confidence, fully matched PZ/ZW or unambiguous project WZ/RW or exact two-warehouse MM. Exceptions remain drafts.';
