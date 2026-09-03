-- Warehouse 3.0 production guardrails.
-- Completes FK indexing, makes review recalculation DELETE-safe and protects
-- price history from malformed AI issue-date strings.

create index if not exists warehouse_ai_lines_candidate_stock_item_id_idx
  on public.warehouse_ai_lines(candidate_stock_item_id);
create index if not exists warehouse_ai_lines_document_id_idx
  on public.warehouse_ai_lines(document_id);
create index if not exists warehouse_ai_lines_workspace_id_idx
  on public.warehouse_ai_lines(workspace_id);
create index if not exists warehouse_document_reviews_document_id_idx
  on public.warehouse_document_reviews(document_id);

create or replace function private.recalc_warehouse_document_review_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_review_id uuid;
begin
  if tg_op = 'DELETE' then
    v_review_id := old.review_id;
  else
    v_review_id := new.review_id;
  end if;

  if v_review_id is not null then
    perform private.recalc_warehouse_document_review(v_review_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.capture_warehouse_ai_price()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_review public.warehouse_document_reviews%rowtype;
  v_counterparty_id uuid;
  v_observed_at date := current_date;
  v_issue_date text;
begin
  if new.decision not in ('auto_matched','matched','new_item_created')
     or new.candidate_stock_item_id is null
     or new.unit_price is null
     or new.unit_price <= 0 then
    return new;
  end if;

  select * into v_review
  from public.warehouse_document_reviews
  where id = new.review_id;
  if not found then return new; end if;

  if v_review.supplier_tax_id is not null then
    select c.id into v_counterparty_id
    from public.counterparties c
    where c.workspace_id = new.workspace_id
      and c.tax_id = v_review.supplier_tax_id
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

  select nullif(de.payload #>> '{businessDocument,issueDate}', '')
  into v_issue_date
  from public.document_extractions de
  where de.document_version_id = new.document_version_id
    and de.extraction_type = 'document_context'
  order by de.created_at desc
  limit 1;

  if v_issue_date is not null and v_issue_date ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_observed_at := v_issue_date::date;
    exception when others then
      v_observed_at := current_date;
    end;
  end if;

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
