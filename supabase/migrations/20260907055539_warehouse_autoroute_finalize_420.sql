-- Warehouse 4.2 — automatic routing after successful multi-document analysis.
-- Fixes an unassigned PL/pgSQL RECORD in 3-way matching and turns safely
-- materialized warehouse proposals into canonical warehouse rows without
-- auto-approving physical stock movements.

do $migration$
declare
  v_def text;
  v_old text := 'v_trace:=v_line.procurement_trace_id; v_po:=null; v_candidate_count:=0; v_order_id:=null;';
  v_new text := 'v_trace:=v_line.procurement_trace_id; select null::uuid as id, null::numeric as quantity, null::numeric as unit_price, null::uuid as procurement_trace_id, null::uuid as order_project_id, null::uuid as order_id into v_po; v_candidate_count:=0; v_order_id:=null;';
begin
  select pg_get_functiondef('public.refresh_procurement_matches_for_invoice_atomic(uuid,uuid,uuid)'::regprocedure)
    into v_def;

  if position(v_old in v_def) > 0 then
    v_def := replace(v_def, v_old, v_new);
    execute v_def;
  elsif position('select null::uuid as id, null::numeric as quantity' in v_def) = 0 then
    raise exception 'Nie znaleziono oczekiwanego fragmentu refresh_procurement_matches_for_invoice_atomic.';
  end if;
end;
$migration$;

create or replace function private.finalize_warehouse_review_after_invoice_link()
returns trigger
language plpgsql
security definer
set search_path = 'public','private','pg_temp'
as $function$
declare
  v_movement_count integer := 0;
  v_movement uuid;
begin
  if new.invoice_id is null then
    return new;
  end if;

  update public.warehouse_ai_lines l
     set candidate_stock_item_id = il.stock_item_id,
         decision = 'new_item_created',
         decision_reason = 'Kartoteka magazynowa została utworzona automatycznie podczas kanonizacji faktury; pozycja nie wymaga ręcznego potwierdzenia.',
         match_confidence = greatest(coalesce(l.match_confidence,0),0.95)
    from public.invoice_lines il
   where l.review_id = new.id
     and il.invoice_id = new.invoice_id
     and il.line_number = l.source_line_index
     and il.line_type = 'material'
     and il.stock_item_id is not null
     and l.decision = 'new_item_proposed';

  select count(*)::integer
    into v_movement_count
    from public.stock_movements sm
   where sm.workspace_id = new.workspace_id
     and sm.source_invoice_id = new.invoice_id
     and sm.status = 'draft';

  if v_movement_count = 1 then
    select sm.id
      into v_movement
      from public.stock_movements sm
     where sm.workspace_id = new.workspace_id
       and sm.source_invoice_id = new.invoice_id
       and sm.status = 'draft'
     order by sm.created_at desc
     limit 1;

    update public.warehouse_document_reviews
       set draft_movement_id = v_movement,
           updated_at = now()
     where id = new.id;
  end if;

  perform private.recalc_warehouse_document_review(new.id);
  return new;
end;
$function$;

revoke all on function private.finalize_warehouse_review_after_invoice_link() from public;

drop trigger if exists warehouse_finalize_after_invoice_link_420 on public.warehouse_document_reviews;
create trigger warehouse_finalize_after_invoice_link_420
after update of invoice_id on public.warehouse_document_reviews
for each row
when (new.invoice_id is not null and old.invoice_id is distinct from new.invoice_id)
execute function private.finalize_warehouse_review_after_invoice_link();
