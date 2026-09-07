create or replace function private.capture_warehouse_ai_price()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_review public.warehouse_document_reviews%rowtype;
  v_counterparty uuid;
  v_price numeric;
begin
  if new.decision not in ('auto_matched','matched','new_item_created') or new.candidate_stock_item_id is null then
    return new;
  end if;

  v_price := coalesce(new.normalized_unit_price,new.unit_price);
  if v_price is null or v_price <= 0 then
    return new;
  end if;

  select * into v_review
  from public.warehouse_document_reviews
  where id = new.review_id;
  if not found then
    return new;
  end if;

  -- Once the canonical invoice line exists, it is the only purchase-price source
  -- visible to business logic. Never recreate the temporary AI shadow observation.
  if v_review.invoice_id is not null and exists (
    select 1
    from public.invoice_lines il
    where il.invoice_id = v_review.invoice_id
      and il.line_number = new.source_line_index
      and il.stock_item_id = new.candidate_stock_item_id
  ) then
    delete from public.price_observations
    where workspace_id = new.workspace_id
      and source_type = 'warehouse_ai_line'
      and source_id = new.id;
    return new;
  end if;

  if v_review.supplier_tax_id is not null then
    select id into v_counterparty
    from public.counterparties
    where workspace_id = new.workspace_id and tax_id = v_review.supplier_tax_id
    order by active desc,created_at desc
    limit 1;
  end if;

  if v_counterparty is null and v_review.supplier_name is not null then
    select id into v_counterparty
    from public.counterparties
    where workspace_id = new.workspace_id
      and public.normalize_material_key(name)=public.normalize_material_key(v_review.supplier_name)
    order by active desc,created_at desc
    limit 1;
  end if;

  insert into public.price_observations(
    workspace_id,project_id,stock_item_id,counterparty_id,source_type,source_id,
    observed_at,quantity,unit,unit_price_net,currency,price_stage,canonical_purchase
  )
  values(
    new.workspace_id,v_review.project_id,new.candidate_stock_item_id,v_counterparty,
    'warehouse_ai_line',new.id,coalesce(v_review.document_date,current_date),new.quantity,
    new.unit,v_price,coalesce(new.currency,'PLN'),'document_ai',false
  )
  on conflict(workspace_id,source_type,source_id) do update set
    project_id=excluded.project_id,
    stock_item_id=excluded.stock_item_id,
    counterparty_id=excluded.counterparty_id,
    observed_at=excluded.observed_at,
    quantity=excluded.quantity,
    unit=excluded.unit,
    unit_price_net=excluded.unit_price_net,
    currency=excluded.currency,
    price_stage=excluded.price_stage;

  return new;
end;
$function$;

create or replace function private.cleanup_shadow_ai_price_on_canonical_purchase()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $function$
declare
  v_invoice_id uuid;
  v_line_number integer;
  v_stock_item_id uuid;
begin
  if new.source_type <> 'invoice_line' then
    return new;
  end if;

  select il.invoice_id, il.line_number, il.stock_item_id
    into v_invoice_id, v_line_number, v_stock_item_id
  from public.invoice_lines il
  where il.id = new.source_id
    and il.workspace_id = new.workspace_id;

  if v_invoice_id is null then
    return new;
  end if;

  delete from public.price_observations shadow
  using public.warehouse_ai_lines wal,
        public.warehouse_document_reviews wr
  where shadow.workspace_id = new.workspace_id
    and shadow.source_type = 'warehouse_ai_line'
    and shadow.source_id = wal.id
    and wal.review_id = wr.id
    and wr.invoice_id = v_invoice_id
    and wal.source_line_index = v_line_number
    and wal.candidate_stock_item_id = v_stock_item_id;

  return new;
end;
$function$;

drop trigger if exists price_observations_cleanup_ai_shadow on public.price_observations;
create trigger price_observations_cleanup_ai_shadow
after insert or update of source_type,source_id,stock_item_id on public.price_observations
for each row
execute function private.cleanup_shadow_ai_price_on_canonical_purchase();

-- Clean only exact AI shadows for invoice lines already materialized in the canonical invoice.
delete from public.price_observations shadow
using public.warehouse_ai_lines wal,
      public.warehouse_document_reviews wr,
      public.invoice_lines il,
      public.price_observations canonical
where shadow.source_type = 'warehouse_ai_line'
  and shadow.source_id = wal.id
  and wal.review_id = wr.id
  and wr.invoice_id = il.invoice_id
  and wal.source_line_index = il.line_number
  and wal.candidate_stock_item_id = il.stock_item_id
  and canonical.workspace_id = shadow.workspace_id
  and canonical.source_type = 'invoice_line'
  and canonical.source_id = il.id;
