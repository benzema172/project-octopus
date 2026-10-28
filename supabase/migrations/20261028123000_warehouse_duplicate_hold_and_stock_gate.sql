-- Protect the physical inventory from automatic approvals of potentially
-- repeated supplier deliveries and cross-format WZ/PZ/MM imports.
CREATE OR REPLACE FUNCTION private.try_auto_approve_warehouse_review_600(p_review_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
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

  -- Incoming invoices and delivery documents must be reconciled against each
  -- other before inventory counts are mutated. Multiple models can suggest
  -- links, but only an explicit warehouse decision may post quantities.
  if upper(trim(coalesce(v_review.document_type,''))) in ('PZ','WZ','MM','RW','ZW','DELIVERY') then
    return 'manual_reconciliation_required_20261028';
  end if;
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

-- Mark exact same-type document identity as a candidate without discarding
-- either source file. The review remains on hold until a human resolves it.
create or replace function private.octopus_material_duplicate_hold_20261028()
returns trigger
language plpgsql security definer
set search_path = 'public','private','pg_temp'
as $body$
declare
  v_match uuid;
  v_number text;
  v_type text;
  v_supplier text;
begin
  v_number:=lower(regexp_replace(coalesce(new.document_number,''),'[[:space:]]+','','g'));
  v_type:=upper(trim(coalesce(new.document_type,'')));
  v_supplier:=regexp_replace(coalesce(new.supplier_tax_id,''),'[^0-9]','','g');
  if length(v_number) < 2 or v_type not in ('WZ','PZ','MM','RW','ZW','DELIVERY') then return new; end if;

  select w.id into v_match
  from public.warehouse_document_reviews w
  where w.workspace_id=new.workspace_id
    and w.id<>new.id
    and w.document_id<>new.document_id
    and upper(trim(coalesce(w.document_type,'')))=v_type
    and lower(regexp_replace(coalesce(w.document_number,''),'[[:space:]]+','','g'))=v_number
    and (w.document_date is null or new.document_date is null or w.document_date=new.document_date)
    and (
      (v_supplier<>'' and regexp_replace(coalesce(w.supplier_tax_id,''),'[^0-9]','','g')=v_supplier)
      or (v_type='MM' and v_supplier='' and coalesce(w.supplier_tax_id,'')='')
    )
  order by w.created_at asc limit 1;

  if v_match is not null then
    new.status:='waiting';
    new.material_flow_metadata:=coalesce(new.material_flow_metadata,'{}'::jsonb)
      ||jsonb_build_object('duplicateCheck','needs_human',
        'duplicateCandidateReviewId',v_match,
        'identityEvidence','type+document_number+supplier+date',
        'automaticStockApprovalBlocked',true);
  end if;
  return new;
end;
$body$;

drop trigger if exists octopus_material_duplicate_hold_20261028
on public.warehouse_document_reviews;
create trigger octopus_material_duplicate_hold_20261028
before insert or update of status,document_number,document_type,supplier_tax_id,document_date
on public.warehouse_document_reviews
for each row execute function private.octopus_material_duplicate_hold_20261028();

revoke all on function private.octopus_material_duplicate_hold_20261028()
from public,anon,authenticated;
