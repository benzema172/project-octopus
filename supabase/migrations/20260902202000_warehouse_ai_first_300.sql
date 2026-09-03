-- Warehouse 3.0: AI-first line resolution and human exception queue.
-- Additive only: real stock continues to change exclusively through approved warehouse movements.

create table if not exists public.warehouse_document_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  source_module text,
  document_type text,
  document_number text,
  supplier_name text,
  supplier_tax_id text,
  document_name text,
  ai_summary text,
  confidence numeric(5,4) not null default 0,
  total_lines integer not null default 0,
  stock_lines integer not null default 0,
  review_lines integer not null default 0,
  non_stock_lines integer not null default 0,
  status text not null default 'waiting' check (status in ('warehouse','waiting','ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_version_id)
);

create index if not exists warehouse_document_reviews_workspace_status_idx
  on public.warehouse_document_reviews(workspace_id, status, updated_at desc);

create table if not exists public.warehouse_ai_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  review_id uuid not null references public.warehouse_document_reviews(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  source_line_index integer not null,
  raw_description text not null,
  normalized_description text not null default '',
  line_class text not null default 'unknown' check (line_class in ('material','device','tool','spare_part','consumable','service','transport','labor','fee','informational','unknown')),
  quantity numeric,
  unit text,
  unit_price numeric,
  normalized_unit_price numeric,
  currency text,
  supplier_sku text,
  manufacturer text,
  model text,
  ean text,
  candidate_stock_item_id uuid references public.stock_items(id) on delete set null,
  match_confidence numeric(5,4) not null default 0,
  decision text not null default 'needs_review' check (decision in ('auto_matched','matched','new_item_proposed','new_item_created','needs_review','non_stock','rejected')),
  decision_reason text,
  ai_metadata jsonb not null default '{}'::jsonb,
  human_corrected boolean not null default false,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_version_id, source_line_index)
);

create index if not exists warehouse_ai_lines_review_decision_idx
  on public.warehouse_ai_lines(review_id, decision, source_line_index);
create index if not exists warehouse_ai_lines_workspace_candidate_idx
  on public.warehouse_ai_lines(workspace_id, candidate_stock_item_id)
  where candidate_stock_item_id is not null;

alter table public.warehouse_document_reviews enable row level security;
alter table public.warehouse_ai_lines enable row level security;

drop policy if exists "domain members can read" on public.warehouse_document_reviews;
create policy "domain members can read" on public.warehouse_document_reviews
  for select using (private.has_domain_access(workspace_id, 'warehouse'::text, 'read'::text, null::uuid));

drop policy if exists "domain members can read" on public.warehouse_ai_lines;
create policy "domain members can read" on public.warehouse_ai_lines
  for select using (private.has_domain_access(workspace_id, 'warehouse'::text, 'read'::text, null::uuid));

create or replace function private.warehouse_line_class(p_line jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_type text := lower(coalesce(p_line->>'lineType',''));
  v_expense text := lower(coalesce(p_line->>'expenseCategory',''));
  v_description text := lower(coalesce(p_line->>'description',''));
begin
  if v_type = 'material' then
    if v_expense = 'equipment' or v_description ~ '(wiertnic|zgrzewark|młot|mlot|wkrętark|wkretark|miernik|kamera|pompa|sprężark|sprezark|agregat|narzędz|narzedz)' then return 'device'; end if;
    if v_description ~ '(filtr|wkład|wklad|uszczelk|łożysk|lozysk|część|czesc zamien)' then return 'spare_part'; end if;
    if v_description ~ '(taśm|tasm|klej|smar|czyściw|czysciw|elektrod|gaz technicz|materiał eksploat|material eksploat)' then return 'consumable'; end if;
    return 'material';
  end if;

  if v_expense = 'equipment' then return 'device'; end if;
  if v_expense = 'transport' or v_description ~ '(transport|dostaw|wysyłk|wysylk|kurier|fracht|hds)' then return 'transport'; end if;
  if v_expense = 'subcontract' or v_description ~ '(robocizn|montaż|montaz|demontaż|demontaz|wykonanie prac)' then return 'labor'; end if;
  if v_type = 'service' or v_description ~ '(usługa|usluga|serwis|przegląd|przeglad|wynajem)' then return 'service'; end if;
  if v_description ~ '(rabat|opłat|oplata|prowizj|odsetk|zaokrąg|zaokrag)' then return 'fee'; end if;
  if v_description ~ '(uwaga|informacyj|podsumowanie|razem)' then return 'informational'; end if;
  return 'unknown';
end;
$$;

create or replace function private.recalc_warehouse_document_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_total integer;
  v_stock integer;
  v_review integer;
  v_non_stock integer;
  v_status text;
begin
  select
    count(*),
    count(*) filter (where decision in ('auto_matched','matched','new_item_created')),
    count(*) filter (where decision in ('needs_review','new_item_proposed')),
    count(*) filter (where decision in ('non_stock','rejected'))
  into v_total, v_stock, v_review, v_non_stock
  from public.warehouse_ai_lines
  where review_id = p_review_id;

  v_status := case
    when coalesce(v_review,0) > 0 then 'waiting'
    when coalesce(v_stock,0) > 0 then 'warehouse'
    else 'waiting'
  end;

  update public.warehouse_document_reviews
  set total_lines = coalesce(v_total,0),
      stock_lines = coalesce(v_stock,0),
      review_lines = coalesce(v_review,0),
      non_stock_lines = coalesce(v_non_stock,0),
      status = case when status = 'ignored' then 'ignored' else v_status end,
      updated_at = now()
  where id = p_review_id;
end;
$$;

create or replace function private.recalc_warehouse_document_review_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.recalc_warehouse_document_review(coalesce(new.review_id, old.review_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists warehouse_ai_lines_recalc_review on public.warehouse_ai_lines;
create trigger warehouse_ai_lines_recalc_review
  after insert or update or delete on public.warehouse_ai_lines
  for each row execute function private.recalc_warehouse_document_review_trigger();

create or replace function private.resolve_warehouse_document_extraction()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_review_id uuid;
  v_line jsonb;
  v_idx integer;
  v_description text;
  v_normalized text;
  v_line_class text;
  v_supplier_name text := nullif(new.payload #>> '{businessDocument,supplierName}', '');
  v_supplier_tax_id text := nullif(new.payload #>> '{businessDocument,supplierTaxId}', '');
  v_currency text := coalesce(nullif(new.payload #>> '{businessDocument,currency}', ''), 'PLN');
  v_source_module text;
  v_document_name text;
  v_candidate uuid;
  v_match numeric;
  v_decision text;
  v_reason text;
  v_line_count integer := 0;
begin
  if new.extraction_type <> 'document_context' then return new; end if;

  select nullif(di.source_metadata->>'sourceModule','')
  into v_source_module
  from public.document_intakes di
  where di.document_id = new.document_id
  limit 1;

  if coalesce(v_source_module, '') <> 'warehouse' then return new; end if;

  select dv.file_name into v_document_name
  from public.document_versions dv
  where dv.id = new.document_version_id;

  insert into public.warehouse_document_reviews (
    workspace_id, document_id, document_version_id, source_module,
    document_type, document_number, supplier_name, supplier_tax_id,
    document_name, ai_summary, confidence, status, updated_at
  ) values (
    new.workspace_id, new.document_id, new.document_version_id, v_source_module,
    nullif(new.payload #>> '{businessDocument,documentType}', ''),
    nullif(new.payload #>> '{businessDocument,documentNumber}', ''),
    v_supplier_name, v_supplier_tax_id, v_document_name,
    nullif(new.payload->>'summary',''), coalesce(new.confidence,0), 'waiting', now()
  )
  on conflict (document_version_id) do update set
    source_module = excluded.source_module,
    document_type = excluded.document_type,
    document_number = excluded.document_number,
    supplier_name = excluded.supplier_name,
    supplier_tax_id = excluded.supplier_tax_id,
    document_name = excluded.document_name,
    ai_summary = excluded.ai_summary,
    confidence = excluded.confidence,
    status = case when public.warehouse_document_reviews.status = 'ignored' then 'ignored' else 'waiting' end,
    updated_at = now()
  returning id into v_review_id;

  delete from public.warehouse_ai_lines where document_version_id = new.document_version_id;

  for v_line, v_idx in
    select value, ordinality::integer
    from jsonb_array_elements(coalesce(new.payload #> '{businessDocument,lines}', '[]'::jsonb)) with ordinality
  loop
    v_line_count := v_line_count + 1;
    v_description := trim(coalesce(v_line->>'description',''));
    if v_description = '' then continue; end if;
    v_normalized := public.normalize_material_key(v_description);
    v_line_class := private.warehouse_line_class(v_line);
    v_candidate := null;
    v_match := 0;
    v_decision := 'needs_review';
    v_reason := 'AI nie znalazło jednoznacznego dopasowania.';

    if v_line_class in ('material','device','tool','spare_part','consumable') then
      select ma.stock_item_id, greatest(coalesce(ma.confidence,0.9), 0.94)
      into v_candidate, v_match
      from public.material_aliases ma
      where ma.workspace_id = new.workspace_id
        and ma.status = 'approved'
        and (
          (nullif(v_line->>'sku','') is not null and ma.supplier_sku = nullif(v_line->>'sku',''))
          or ma.normalized_key = v_normalized
        )
        and (
          v_supplier_name is null
          or ma.supplier_name is null
          or public.normalize_material_key(ma.supplier_name) = public.normalize_material_key(v_supplier_name)
        )
      order by
        case when nullif(v_line->>'sku','') is not null and ma.supplier_sku = nullif(v_line->>'sku','') then 0 else 1 end,
        ma.confidence desc,
        ma.created_at desc
      limit 1;

      if v_candidate is null then
        select si.id,
               case
                 when nullif(v_line->>'sku','') is not null and si.sku = nullif(v_line->>'sku','') then 0.98
                 when public.normalize_material_key(si.name) = v_normalized then 0.93
                 else 0.78
               end
        into v_candidate, v_match
        from public.stock_items si
        where si.workspace_id = new.workspace_id
          and si.active = true
          and (
            (nullif(v_line->>'sku','') is not null and si.sku = nullif(v_line->>'sku',''))
            or public.normalize_material_key(si.name) = v_normalized
            or (length(v_normalized) >= 6 and (
              public.normalize_material_key(si.name) like '%' || v_normalized || '%'
              or v_normalized like '%' || public.normalize_material_key(si.name) || '%'
            ))
          )
        order by
          case when nullif(v_line->>'sku','') is not null and si.sku = nullif(v_line->>'sku','') then 0
               when public.normalize_material_key(si.name) = v_normalized then 1 else 2 end,
          si.name
        limit 1;
      end if;

      if v_candidate is not null and v_match >= 0.90 then
        v_decision := 'auto_matched';
        v_reason := 'Pozycję automatycznie dopasowano do istniejącej kartoteki na podstawie indeksu, wyuczonego aliasu lub znormalizowanej nazwy.';
      elsif v_candidate is not null then
        v_decision := 'needs_review';
        v_reason := 'Znaleziono podobną kartotekę, ale pewność wymaga szybkiego potwierdzenia.';
      else
        v_decision := 'new_item_proposed';
        v_reason := 'AI rozpoznało fizyczny materiał lub urządzenie, ale nie znalazło istniejącej kartoteki.';
      end if;
    elsif v_line_class in ('service','transport','labor','fee','informational') then
      v_decision := 'non_stock';
      v_reason := 'Pozycja została rozpoznana jako koszt lub usługa bez wpływu na stan magazynowy.';
    else
      v_decision := 'needs_review';
      v_reason := 'AI nie potrafi jednoznacznie rozstrzygnąć, czy pozycja jest zapasem.';
    end if;

    insert into public.warehouse_ai_lines (
      workspace_id, review_id, document_id, document_version_id, source_line_index,
      raw_description, normalized_description, line_class, quantity, unit,
      unit_price, normalized_unit_price, currency, supplier_sku,
      candidate_stock_item_id, match_confidence, decision, decision_reason, ai_metadata
    ) values (
      new.workspace_id, v_review_id, new.document_id, new.document_version_id, v_idx,
      v_description, v_normalized, v_line_class,
      nullif(v_line->>'quantity','')::numeric,
      nullif(v_line->>'unit',''),
      nullif(v_line->>'unitPrice','')::numeric,
      nullif(v_line->>'unitPrice','')::numeric,
      v_currency,
      nullif(v_line->>'sku',''),
      v_candidate, coalesce(v_match,0), v_decision, v_reason,
      jsonb_build_object(
        'geminiLineType', v_line->>'lineType',
        'expenseCategory', v_line->>'expenseCategory',
        'lineConfidence', coalesce(nullif(v_line->>'confidence','')::numeric, new.confidence, 0),
        'supplierName', v_supplier_name,
        'supplierTaxId', v_supplier_tax_id
      )
    );
  end loop;

  if v_line_count = 0 then
    insert into public.warehouse_ai_lines (
      workspace_id, review_id, document_id, document_version_id, source_line_index,
      raw_description, normalized_description, line_class, match_confidence,
      decision, decision_reason, ai_metadata
    ) values (
      new.workspace_id, v_review_id, new.document_id, new.document_version_id, 0,
      '[Brak rozpoznanych pozycji towarowych]', '', 'informational', 0,
      'needs_review',
      'AI nie rozpoznało pozycji materiałowych ani urządzeń. Dokument wymaga szybkiej decyzji w Poczekalni.',
      jsonb_build_object('documentOnly', true, 'sourceModule', v_source_module)
    );
  end if;

  perform private.recalc_warehouse_document_review(v_review_id);
  return new;
end;
$$;

drop trigger if exists warehouse_document_extraction_resolver on public.document_extractions;
create trigger warehouse_document_extraction_resolver
  after insert or update of payload on public.document_extractions
  for each row
  when (new.extraction_type = 'document_context')
  execute function private.resolve_warehouse_document_extraction();

comment on table public.warehouse_document_reviews is 'Warehouse 3.0 document-level AI routing state; waiting is the human exception queue.';
comment on table public.warehouse_ai_lines is 'Warehouse 3.0 line-level AI decisions. These rows never change real stock directly.';
