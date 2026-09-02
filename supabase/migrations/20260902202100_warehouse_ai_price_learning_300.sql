-- Warehouse 3.0: automatic price observation for high-confidence AI matches
-- and backfill of previously analyzed documents sent through the Warehouse Wrzutnia.

create or replace function private.capture_warehouse_ai_price()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_review public.warehouse_document_reviews%rowtype;
  v_counterparty_id uuid;
  v_observed_at date;
begin
  if new.decision not in ('auto_matched','matched','new_item_created')
     or new.candidate_stock_item_id is null
     or new.unit_price is null
     or new.unit_price <= 0 then
    return new;
  end if;

  select * into v_review from public.warehouse_document_reviews where id = new.review_id;
  if not found then return new; end if;

  if v_review.supplier_tax_id is not null then
    select c.id into v_counterparty_id
    from public.counterparties c
    where c.workspace_id = new.workspace_id and c.tax_id = v_review.supplier_tax_id
    order by c.active desc, c.created_at desc
    limit 1;
  end if;
  if v_counterparty_id is null and v_review.supplier_name is not null then
    select c.id into v_counterparty_id
    from public.counterparties c
    where c.workspace_id = new.workspace_id
      and public.normalize_material_key(c.name) = public.normalize_material_key(v_review.supplier_name)
    order by c.active desc, c.created_at desc
    limit 1;
  end if;

  select coalesce(nullif(de.payload #>> '{businessDocument,issueDate}','')::date, current_date)
  into v_observed_at
  from public.document_extractions de
  where de.document_version_id = new.document_version_id
    and de.extraction_type = 'document_context'
  order by de.created_at desc
  limit 1;
  v_observed_at := coalesce(v_observed_at, current_date);

  insert into public.price_observations (
    workspace_id, stock_item_id, counterparty_id, source_type, source_id,
    observed_at, quantity, unit, unit_price_net, currency, price_stage, canonical_purchase
  ) values (
    new.workspace_id, new.candidate_stock_item_id, v_counterparty_id,
    'warehouse_ai_line', new.id, v_observed_at, new.quantity, new.unit,
    new.unit_price, coalesce(new.currency,'PLN'), 'document_ai', false
  )
  on conflict (workspace_id, source_type, source_id) do update set
    stock_item_id = excluded.stock_item_id,
    counterparty_id = excluded.counterparty_id,
    observed_at = excluded.observed_at,
    quantity = excluded.quantity,
    unit = excluded.unit,
    unit_price_net = excluded.unit_price_net,
    currency = excluded.currency,
    price_stage = excluded.price_stage;

  return new;
end;
$$;

drop trigger if exists warehouse_ai_lines_capture_price on public.warehouse_ai_lines;
create trigger warehouse_ai_lines_capture_price
  after insert or update of decision, candidate_stock_item_id, unit_price on public.warehouse_ai_lines
  for each row execute function private.capture_warehouse_ai_price();

create or replace function private.cleanup_warehouse_ai_price()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  delete from public.price_observations
  where workspace_id = old.workspace_id
    and source_type = 'warehouse_ai_line'
    and source_id = old.id;
  return old;
end;
$$;

drop trigger if exists warehouse_ai_lines_cleanup_price on public.warehouse_ai_lines;
create trigger warehouse_ai_lines_cleanup_price
  after delete on public.warehouse_ai_lines
  for each row execute function private.cleanup_warehouse_ai_price();

-- Existing analyzed documents from Warehouse Wrzutnia should immediately appear
-- in Magazyn/Poczekalnia without forcing the user to upload them again.
update public.document_extractions de
set payload = de.payload
where de.extraction_type = 'document_context'
  and de.status <> 'rejected'
  and exists (
    select 1 from public.document_intakes di
    where di.document_id = de.document_id
      and di.source_metadata->>'sourceModule' = 'warehouse'
  );
