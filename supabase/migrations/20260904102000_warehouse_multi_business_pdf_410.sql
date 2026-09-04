begin;

-- Warehouse 4.1: jeden PDF może zawierać wiele niezależnych faktur/WZ/PZ.
drop index if exists public.invoices_document_uidx;
create index if not exists invoices_workspace_document_lookup_idx
  on public.invoices(workspace_id, document_id, created_at desc)
  where document_id is not null;

alter table public.warehouse_document_reviews
  add column if not exists source_document_index integer not null default 1,
  add column if not exists source_page_start integer,
  add column if not exists source_page_end integer,
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

alter table public.warehouse_ai_lines
  add column if not exists source_document_index integer not null default 1;

alter table public.warehouse_document_reviews
  drop constraint if exists warehouse_document_reviews_document_version_id_key;
alter table public.warehouse_document_reviews
  add constraint warehouse_document_reviews_version_source_index_key
  unique(document_version_id, source_document_index);

alter table public.warehouse_ai_lines
  drop constraint if exists warehouse_ai_lines_document_version_id_source_line_index_key;
alter table public.warehouse_ai_lines
  add constraint warehouse_ai_lines_version_doc_line_key
  unique(document_version_id, source_document_index, source_line_index);

create index if not exists warehouse_document_reviews_invoice_idx
  on public.warehouse_document_reviews(invoice_id)
  where invoice_id is not null;

drop trigger if exists warehouse_00_prepare_review_31 on public.document_extractions;

create or replace function private.resolve_warehouse_document_extraction()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
as $$
declare
  v_documents jsonb;
  v_business jsonb;
  v_doc_index integer;
  v_review_id uuid;
  v_line jsonb;
  v_idx integer;
  v_description text;
  v_normalized text;
  v_line_class text;
  v_supplier_name text;
  v_supplier_tax_id text;
  v_currency text;
  v_source_module text;
  v_document_name text;
  v_candidate uuid;
  v_match numeric;
  v_decision text;
  v_reason text;
  v_line_count integer;
  v_document_date date;
  v_page_start integer;
  v_page_end integer;
begin
  if new.extraction_type <> 'document_context' then return new; end if;

  select nullif(di.source_metadata->>'sourceModule','')
    into v_source_module
  from public.document_intakes di
  where di.document_id = new.document_id
  limit 1;

  if coalesce(v_source_module,'') <> 'warehouse' then return new; end if;

  select dv.file_name into v_document_name
  from public.document_versions dv
  where dv.id = new.document_version_id;

  if jsonb_typeof(new.payload->'businessDocuments')='array'
     and jsonb_array_length(new.payload->'businessDocuments')>0 then
    v_documents := new.payload->'businessDocuments';
  elsif jsonb_typeof(new.payload->'businessDocument')='object' then
    v_documents := jsonb_build_array(new.payload->'businessDocument');
  else
    v_documents := jsonb_build_array('{}'::jsonb);
  end if;

  delete from public.warehouse_ai_lines
  where document_version_id = new.document_version_id;

  for v_business, v_doc_index in
    select value, ordinality::integer
    from jsonb_array_elements(v_documents) with ordinality
  loop
    v_supplier_name := nullif(v_business->>'supplierName','');
    v_supplier_tax_id := nullif(v_business->>'supplierTaxId','');
    v_currency := coalesce(nullif(v_business->>'currency',''),'PLN');
    v_line_count := 0;
    v_document_date := null;
    v_page_start := null;
    v_page_end := null;

    begin
      v_document_date := nullif(v_business->>'issueDate','')::date;
    exception when others then
      v_document_date := null;
    end;
    if coalesce(v_business->>'sourcePageStart','') ~ '^[0-9]+$' then
      v_page_start := (v_business->>'sourcePageStart')::integer;
    end if;
    if coalesce(v_business->>'sourcePageEnd','') ~ '^[0-9]+$' then
      v_page_end := (v_business->>'sourcePageEnd')::integer;
    end if;

    select count(*)::integer into v_line_count
    from jsonb_array_elements(coalesce(v_business->'lines','[]'::jsonb)) value
    where btrim(coalesce(value->>'description',''))<>'';

    insert into public.warehouse_document_reviews(
      workspace_id,document_id,document_version_id,project_id,source_module,
      source_document_index,source_page_start,source_page_end,
      document_type,document_number,document_direction,document_date,
      supplier_name,supplier_tax_id,document_name,ai_summary,confidence,
      source_line_count,status,updated_at
    ) values(
      new.workspace_id,new.document_id,new.document_version_id,new.project_id,v_source_module,
      v_doc_index,v_page_start,v_page_end,
      nullif(v_business->>'documentType',''),nullif(v_business->>'documentNumber',''),
      nullif(lower(v_business->>'direction'),''),v_document_date,
      v_supplier_name,v_supplier_tax_id,v_document_name,
      nullif(new.payload->>'summary',''),coalesce(new.confidence,0),greatest(v_line_count,1),'waiting',now()
    )
    on conflict(document_version_id,source_document_index) do update set
      project_id=excluded.project_id,
      source_page_start=excluded.source_page_start,
      source_page_end=excluded.source_page_end,
      document_type=excluded.document_type,
      document_number=excluded.document_number,
      document_direction=excluded.document_direction,
      document_date=excluded.document_date,
      supplier_name=excluded.supplier_name,
      supplier_tax_id=excluded.supplier_tax_id,
      document_name=excluded.document_name,
      ai_summary=excluded.ai_summary,
      confidence=excluded.confidence,
      source_line_count=excluded.source_line_count,
      status=case when public.warehouse_document_reviews.status='ignored' then 'ignored' else 'waiting' end,
      updated_at=now()
    returning id into v_review_id;

    v_line_count := 0;
    for v_line, v_idx in
      select value, ordinality::integer
      from jsonb_array_elements(coalesce(v_business->'lines','[]'::jsonb)) with ordinality
    loop
      v_description := trim(coalesce(v_line->>'description',''));
      if v_description='' then continue; end if;
      v_line_count := v_line_count + 1;
      v_normalized := public.normalize_material_key(v_description);
      v_line_class := private.warehouse_line_class(v_line);
      v_candidate := null;
      v_match := 0;
      v_decision := 'needs_review';
      v_reason := 'AI nie znalazło jednoznacznego dopasowania.';

      if v_line_class in ('material','device','tool','spare_part','consumable') then
        select ma.stock_item_id,greatest(coalesce(ma.confidence,0.9),0.94)
          into v_candidate,v_match
        from public.material_aliases ma
        where ma.workspace_id=new.workspace_id
          and ma.status='approved'
          and ((nullif(v_line->>'sku','') is not null and ma.supplier_sku=nullif(v_line->>'sku',''))
               or ma.normalized_key=v_normalized)
          and (v_supplier_name is null or ma.supplier_name is null
               or public.normalize_material_key(ma.supplier_name)=public.normalize_material_key(v_supplier_name))
        order by case when nullif(v_line->>'sku','') is not null and ma.supplier_sku=nullif(v_line->>'sku','') then 0 else 1 end,
                 ma.confidence desc,ma.created_at desc
        limit 1;

        if v_candidate is null then
          select si.id,
                 case when nullif(v_line->>'sku','') is not null and si.sku=nullif(v_line->>'sku','') then 0.98
                      when public.normalize_material_key(si.name)=v_normalized then 0.93 else 0.78 end
            into v_candidate,v_match
          from public.stock_items si
          where si.workspace_id=new.workspace_id and si.active=true
            and ((nullif(v_line->>'sku','') is not null and si.sku=nullif(v_line->>'sku',''))
              or public.normalize_material_key(si.name)=v_normalized
              or (length(v_normalized)>=6 and (
                   public.normalize_material_key(si.name) like '%'||v_normalized||'%'
                   or v_normalized like '%'||public.normalize_material_key(si.name)||'%')))
          order by case when nullif(v_line->>'sku','') is not null and si.sku=nullif(v_line->>'sku','') then 0
                        when public.normalize_material_key(si.name)=v_normalized then 1 else 2 end,
                   si.name
          limit 1;
        end if;

        if v_candidate is not null and v_match>=0.90 then
          v_decision := 'auto_matched';
          v_reason := 'Pozycję automatycznie dopasowano do istniejącej kartoteki na podstawie indeksu, aliasu lub znormalizowanej nazwy.';
        elsif v_candidate is not null then
          v_decision := 'needs_review';
          v_reason := 'Znaleziono podobną kartotekę, ale pewność wymaga potwierdzenia.';
        else
          v_decision := 'new_item_proposed';
          v_reason := 'AI rozpoznało fizyczny materiał lub urządzenie, ale nie znalazło istniejącej kartoteki.';
        end if;
      elsif v_line_class in ('service','transport','labor','fee','informational') then
        v_decision := 'non_stock';
        v_reason := 'Pozycja została rozpoznana jako koszt lub usługa bez wpływu na stan magazynowy.';
      end if;

      insert into public.warehouse_ai_lines(
        workspace_id,review_id,document_id,document_version_id,source_document_index,source_line_index,
        raw_description,normalized_description,line_class,quantity,unit,
        unit_price,normalized_unit_price,currency,supplier_sku,
        candidate_stock_item_id,match_confidence,decision,decision_reason,ai_metadata
      ) values(
        new.workspace_id,v_review_id,new.document_id,new.document_version_id,v_doc_index,v_idx,
        v_description,v_normalized,v_line_class,
        nullif(v_line->>'quantity','')::numeric,nullif(v_line->>'unit',''),
        nullif(v_line->>'unitPrice','')::numeric,nullif(v_line->>'unitPrice','')::numeric,
        v_currency,nullif(v_line->>'sku',''),v_candidate,coalesce(v_match,0),v_decision,v_reason,
        jsonb_build_object(
          'sourceDocumentIndex',v_doc_index,
          'sourcePageStart',v_page_start,
          'sourcePageEnd',v_page_end,
          'geminiLineType',v_line->>'lineType',
          'expenseCategory',v_line->>'expenseCategory',
          'lineConfidence',coalesce(nullif(v_line->>'confidence','')::numeric,new.confidence,0),
          'supplierName',v_supplier_name,'supplierTaxId',v_supplier_tax_id)
      );
    end loop;

    if v_line_count=0 then
      insert into public.warehouse_ai_lines(
        workspace_id,review_id,document_id,document_version_id,source_document_index,source_line_index,
        raw_description,normalized_description,line_class,match_confidence,decision,decision_reason,ai_metadata
      ) values(
        new.workspace_id,v_review_id,new.document_id,new.document_version_id,v_doc_index,0,
        '[Brak rozpoznanych pozycji towarowych]','','informational',0,'needs_review',
        'AI nie rozpoznało pozycji materiałowych ani urządzeń. Dokument wymaga decyzji w Poczekalni.',
        jsonb_build_object('documentOnly',true,'sourceModule',v_source_module,'sourceDocumentIndex',v_doc_index)
      );
    end if;

    perform private.recalc_warehouse_document_review(v_review_id);
  end loop;

  update public.warehouse_document_reviews
    set status='ignored',updated_at=now()
  where document_version_id=new.document_version_id
    and source_document_index>jsonb_array_length(v_documents)
    and draft_movement_id is null;

  return new;
end;
$$;

create or replace function public.orchestrate_approved_business_documents_atomic(
  p_workspace_id uuid,
  p_document_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
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
  v_has_business boolean;
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
  order by created_at desc
  limit 1;
  if v_ext.id is null then raise exception 'Brak ekstrakcji biznesowej dokumentu.'; end if;

  if jsonb_typeof(v_ext.payload->'businessDocuments')='array'
     and jsonb_array_length(v_ext.payload->'businessDocuments')>0 then
    v_documents := v_ext.payload->'businessDocuments';
  elsif jsonb_typeof(v_ext.payload->'businessDocument')='object' then
    v_documents := jsonb_build_array(v_ext.payload->'businessDocument');
  else
    return jsonb_build_object('skipped',true,'reason','no_business_documents','count',0,'documents','[]'::jsonb);
  end if;

  v_source_channel := coalesce(nullif(v_doc.metadata->>'source_channel',''),'upload');

  for v_business, v_idx in
    select value, ordinality::integer
    from jsonb_array_elements(v_documents) with ordinality
  loop
    v_has_business := jsonb_typeof(v_business)='object' and v_business<>'{}'::jsonb and (
      nullif(trim(coalesce(v_business->>'documentNumber',v_business->>'invoiceNumber',v_business->>'ksefNumber','')),'') is not null
      or jsonb_array_length(case when jsonb_typeof(v_business->'lines')='array' then v_business->'lines' else '[]'::jsonb end)>0
      or public.octopus_numeric(v_business->>'grossAmount') is not null
      or public.octopus_numeric(v_business->>'netAmount') is not null
    );
    if not v_has_business then continue; end if;

    v_external_key := p_document_id::text||':business:'||v_idx::text;

    insert into public.business_inbox_items(
      workspace_id,source_channel,external_key,document_id,project_id,document_type,status,
      payload,canonical_payload,canonical_version,received_at
    ) values(
      p_workspace_id,v_source_channel,v_external_key,null,v_doc.project_id,
      lower(coalesce(nullif(v_business->>'documentType',''),v_doc.category)),'processing',
      jsonb_build_object('confidence',v_ext.confidence,'sourceDocumentId',p_document_id,'sourceDocumentIndex',v_idx),
      v_business,'business-document-v2-multi',v_doc.created_at
    )
    on conflict(workspace_id,source_channel,external_key) do update set
      project_id=excluded.project_id,
      document_type=excluded.document_type,
      status='processing',
      payload=excluded.payload,
      canonical_payload=excluded.canonical_payload,
      canonical_version=excluded.canonical_version,
      processing_error=null,
      processed_at=null,
      document_id=case when public.business_inbox_items.invoice_id is null then null else public.business_inbox_items.document_id end
    returning id into v_inbox;

    v_process := public.process_business_inbox_item_atomic(p_workspace_id,v_inbox,p_actor_id);
    if coalesce((v_process->>'ok')::boolean,false)=false then
      raise exception '%',coalesce(v_process->>'error','Orkiestracja dokumentu biznesowego nie powiodła się.');
    end if;

    v_invoice := public.octopus_uuid(v_process #>> '{result,invoiceId}');
    if v_invoice is not null then
      update public.invoices set document_id=p_document_id
      where id=v_invoice and workspace_id=p_workspace_id;

      update public.business_inbox_items
        set document_id=p_document_id,invoice_id=v_invoice
      where id=v_inbox;

      update public.stock_movements
        set source_document_id=p_document_id,
            document_number=coalesce(nullif(document_number,''),nullif(v_business->>'documentNumber',''))
      where workspace_id=p_workspace_id and source_invoice_id=v_invoice;

      update public.warehouse_document_reviews
        set invoice_id=v_invoice,updated_at=now()
      where workspace_id=p_workspace_id
        and document_version_id=v_ext.document_version_id
        and source_document_index=v_idx;
    end if;

    v_count := v_count+1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'sourceDocumentIndex',v_idx,
      'invoiceId',v_invoice,
      'documentNumber',v_business->>'documentNumber',
      'supplierName',v_business->>'supplierName',
      'lineCount',jsonb_array_length(case when jsonb_typeof(v_business->'lines')='array' then v_business->'lines' else '[]'::jsonb end)
    ));
  end loop;

  return jsonb_build_object('skipped',v_count=0,'count',v_count,'documents',v_results,'documentId',p_document_id);
end;
$$;

revoke all on function public.orchestrate_approved_business_documents_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.orchestrate_approved_business_documents_atomic(uuid,uuid,uuid) to service_role;

create or replace function private.create_warehouse_draft_for_review_31(p_review_id uuid,p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public','private','pg_temp'
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
begin
  select * into v_review from public.warehouse_document_reviews where id=p_review_id for update;
  if not found or v_review.status<>'warehouse' then return null; end if;
  if exists(select 1 from public.warehouse_ai_lines where review_id=p_review_id and decision in('needs_review','new_item_proposed')) then return null; end if;
  if (select count(*) from public.warehouse_ai_lines where review_id=p_review_id)<greatest(v_review.source_line_count,1) then return null; end if;

  v_group_key := 'warehouse-ai-31:'||p_review_id::text;
  v_invoice := v_review.invoice_id;
  if v_invoice is null then
    select i.id into v_invoice
    from public.invoices i
    where i.workspace_id=v_review.workspace_id
      and i.document_id=v_review.document_id
      and (v_review.document_number is null or i.invoice_number=v_review.document_number)
    order by i.created_at desc
    limit 1;
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

  v_type:=case when lower(coalesce(v_review.document_direction,'')) in('sale','outgoing','outbound','issue','sales') then 'WZ' else 'PZ' end;

  if v_movement is null then
    insert into public.stock_movements(
      workspace_id,project_id,warehouse_id,movement_type,document_number,movement_date,status,
      source_document_id,source_invoice_id,source_group_key,destination_mode
    ) values(
      v_review.workspace_id,v_review.project_id,v_warehouse,v_type,v_review.document_number,
      coalesce(v_review.document_date,current_date),'draft',v_review.document_id,v_invoice,v_group_key,
      case when v_type='PZ' then 'central_stock' when v_review.project_id is not null then 'direct_project' else 'unassigned' end
    ) returning id into v_movement;
  else
    update public.stock_movements set
      project_id=v_review.project_id,warehouse_id=v_warehouse,movement_type=v_type,
      document_number=v_review.document_number,movement_date=coalesce(v_review.document_date,current_date),
      source_document_id=v_review.document_id,source_invoice_id=v_invoice,source_group_key=v_group_key
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
    delete from public.stock_movements where id=v_movement and status='draft' and source_group_key=v_group_key;
    update public.warehouse_document_reviews set draft_movement_id=null where id=p_review_id;
    return null;
  end if;

  update public.warehouse_document_reviews set draft_movement_id=v_movement,invoice_id=v_invoice,updated_at=now() where id=p_review_id;
  insert into public.audit_events(workspace_id,project_id,actor_id,event_type,entity_type,entity_id,after_value)
  values(v_review.workspace_id,v_review.project_id,p_actor_id,'warehouse.ai_draft_ready','stock_movement',v_movement::text,
    jsonb_build_object('review_id',p_review_id,'source_document_index',v_review.source_document_index,'movement_type',v_type,'lines',v_lines,'status','draft'));
  return v_movement;
end;
$$;

create or replace function public.trg_orchestrate_approved_business_document()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  if new.review_status='approved' and (old.review_status is distinct from new.review_status or old.project_id is distinct from new.project_id) then
    if exists(select 1 from public.document_module_proposals where document_id=new.id and proposal_type in ('finance_line','warehouse_line')) then
      insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,project_id,document_type,status,payload,received_at)
      values(new.workspace_id,coalesce(nullif(new.metadata->>'source_channel',''),'upload'),new.id::text,new.id,new.project_id,new.category,'review',jsonb_build_object('field_review_required',true),new.created_at)
      on conflict(workspace_id,source_channel,external_key) do update set project_id=excluded.project_id,document_type=excluded.document_type,status='review',processed_at=null,payload=coalesce(public.business_inbox_items.payload,'{}'::jsonb)||excluded.payload;
    else
      begin
        perform public.orchestrate_approved_business_documents_atomic(new.workspace_id,new.id,new.approved_by);
      exception when others then
        insert into public.business_inbox_items(workspace_id,source_channel,external_key,document_id,project_id,document_type,status,payload,received_at,processed_at)
        values(new.workspace_id,coalesce(nullif(new.metadata->>'source_channel',''),'upload'),new.id::text,new.id,new.project_id,new.category,'error',jsonb_build_object('error',sqlerrm),new.created_at,now())
        on conflict(workspace_id,source_channel,external_key) do update set status='error',payload=jsonb_build_object('error',sqlerrm),processed_at=now();
      end;
    end if;
  end if;
  return new;
end;
$$;

commit;
