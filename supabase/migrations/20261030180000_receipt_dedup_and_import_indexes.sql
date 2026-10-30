-- Harden auto fuel receipts: unique transaction per source, transaction-level serialization,
-- and duplicate gates for identical uploads and previously recorded receipts.
-- Existing production functions, permissions and history are preserved.
create index if not exists idx_document_pipeline_stages_document_fk_20261030
  on public.document_pipeline_stages(document_id);
create index if not exists idx_document_warehouse_reconciliations_invoice_fk_20261030
  on public.document_warehouse_reconciliations(invoice_id);
create index if not exists idx_document_warehouse_reconciliations_review_fk_20261030
  on public.document_warehouse_reconciliations(warehouse_review_id);
create index if not exists idx_document_versions_workspace_sha256_20261030
  on public.document_versions(workspace_id,sha256)
  where sha256 is not null;
create or replace function public.auto_assign_fuel_receipt_by_registration_20261030(
  p_workspace_id uuid,p_document_id uuid
) returns jsonb language plpgsql security definer
set search_path='public','private','pg_temp' as $$
declare
  v_doc public.documents%rowtype;
  v_extract public.document_extractions%rowtype;
  v_payload jsonb;
  v_docs jsonb;
  v_business jsonb;
  v_line jsonb;
  v_candidate jsonb;
  v_count integer:=0;
  v_plate text;
  v_vehicle_id uuid;
  v_match_count integer;
  v_liters numeric;
  v_amount numeric;
  v_date date;
  v_currency text;
  v_reason text:=null;
  v_entry_id uuid;
  v_review_id uuid;
  v_receipt_count integer:=0;
  v_raw_date text;
  v_hash text;
begin
  select * into v_doc from public.documents
    where id=p_document_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Brak dokumentu firmy.'; end if;
  -- Serialize receipt booking per company. The complete check+insert now runs
  -- under the same lock, so two concurrent uploads cannot both pass the gate.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 20261030));
  select v.sha256 into v_hash from public.document_versions v
    where v.document_id=p_document_id and v.workspace_id=p_workspace_id
    order by v.version_number desc limit 1;
  if v_hash is null or length(v_hash)<>64 then
    return jsonb_build_object('needsReview',true,'reason','missing_source_hash');
  end if;
  select * into v_extract from public.document_extractions
    where workspace_id=p_workspace_id and document_id=p_document_id
      and extraction_type='document_context'
    order by created_at desc, id desc limit 1;
  if not found then return jsonb_build_object('skipped','no_extraction'); end if;
  v_payload:=coalesce(v_extract.payload,'{}'::jsonb);
  v_docs:=case when jsonb_typeof(v_payload->'businessDocuments')='array'
    then v_payload->'businessDocuments'
    else jsonb_build_array(coalesce(v_payload->'businessDocument','{}'::jsonb)) end;
  select count(*)::integer into v_receipt_count from jsonb_array_elements(v_docs) doc
    where lower(coalesce(doc->>'documentType',''))='receipt';
  if v_receipt_count<>1 or jsonb_array_length(v_docs)<>1 then
    return jsonb_build_object('skipped','not_single_receipt');
  end if;
  v_business:=v_docs->0;
  if lower(coalesce(v_business->>'direction','purchase'))<>'purchase' then
    return jsonb_build_object('skipped','not_purchase');
  end if;
  if exists(select 1 from public.invoices i
     where i.workspace_id=p_workspace_id and i.document_id=p_document_id) then
    return jsonb_build_object('skipped','canonical_invoice_exists');
  end if;
  if exists(select 1 from public.fuel_entries f
     where f.workspace_id=p_workspace_id and f.source_document_id=p_document_id) then
    return jsonb_build_object('skipped','already_booked');
  end if;
  -- Same bytes under a different document ID are not a new purchase.
  if exists (
    select 1 from public.document_versions other_version
    join public.fuel_entries existing on existing.source_document_id=other_version.document_id
      and existing.workspace_id=p_workspace_id
    where other_version.workspace_id=p_workspace_id
      and other_version.document_id<>p_document_id
      and other_version.sha256=v_hash
  ) then return jsonb_build_object('needsReview',true,'reason','duplicate_source_sha256'); end if;

  for v_candidate in select value from jsonb_array_elements(
    case when jsonb_typeof(v_business->'lines')='array' then v_business->'lines' else '[]'::jsonb end
  ) elem(value) loop
    if private.is_motor_fuel_line_20261030(
      v_candidate->>'description',v_candidate->>'expenseCategory',v_candidate)
    then v_count:=v_count+1;v_line:=v_candidate; end if;
  end loop;
  if v_count<>1 then
    return jsonb_build_object('skipped','ambiguous_fuel_items');
  end if;

  v_plate:=private.normalize_fuel_plate_20261030(v_line->>'vehicleRegistration');
  v_currency:=upper(coalesce(nullif(v_business->>'currency',''),'PLN'));
  v_raw_date:=v_business->>'issueDate';
  v_date:=case when v_raw_date ~ '^\d{4}-\d{2}-\d{2}$'
    then nullif(v_raw_date,'')::date else null end;
  v_liters:=coalesce(
    case when (v_line->>'liters') ~ '^[0-9]+([.][0-9]+)?$'
      and (v_line->>'liters')::numeric>0 then (v_line->>'liters')::numeric end,
    case when lower(coalesce(v_line->>'unit','')) in ('l','lt','ltr','litr','litry','litrów','dm3','dm³')
      and (v_line->>'quantity') ~ '^[0-9]+([.][0-9]+)?$'
      then (v_line->>'quantity')::numeric end
  );
  v_amount:=case when (v_line->>'grossAmount') ~ '^[0-9]+([.][0-9]+)?$'
    then (v_line->>'grossAmount')::numeric end;

  if v_plate is null or length(v_plate)<4 or length(v_plate)>9 then
    v_reason:='Brak jednoznacznego numeru rejestracyjnego na paragonie.';
  else
    select count(*)::integer,min(id) into v_match_count,v_vehicle_id
    from public.vehicles where workspace_id=p_workspace_id and status<>'sold'
      and private.normalize_fuel_plate_20261030(registration_number)=v_plate;
    if v_match_count<>1 then
      v_reason:=case when v_match_count=0 then 'Brak tego pojazdu we Flocie.'
        else 'Zduplikowana rejestracja pojazdów we Flocie.' end;
    end if;
  end if;
  if v_reason is null and (v_liters is null or v_liters<=0 or v_liters>20000
      or v_amount is null or v_amount<=0 or v_amount>1000000
      or v_date is null or v_currency<>'PLN') then
    v_reason:='Paragon ma niepełną datę, kwotę, litry lub nieobsługiwaną walutę.';
  end if;
  if v_reason is null and exists(select 1 from public.fuel_entries f
     where f.workspace_id=p_workspace_id and f.vehicle_id=v_vehicle_id
       and f.fueled_at::date=v_date
       and abs(f.liters-v_liters)<0.001 and abs(f.gross_amount-v_amount)<0.01)
  then v_reason:='Możliwy duplikat paragonu i tankowania; wymagana kontrola.'; end if;
  -- Also match previously applied receipts by supplier/document number and date,
  -- even where OCR expressed liters or money with small rounding differences.
  if v_reason is null
    and nullif(btrim(coalesce(v_business->>'documentNumber','')),'') is not null
    and exists(
      select 1 from public.fleet_document_reviews existing_review
      join public.fuel_entries earlier on earlier.source_document_id=existing_review.document_id
        and earlier.workspace_id=p_workspace_id
      where existing_review.workspace_id=p_workspace_id
        and existing_review.document_id<>p_document_id
        and existing_review.document_type='fuel_receipt'
        and existing_review.document_date=v_date
        and lower(btrim(coalesce(existing_review.document_number,''))) =
            lower(btrim(v_business->>'documentNumber'))
        and lower(btrim(coalesce(existing_review.provider_name,''))) =
            lower(btrim(coalesce(v_business->>'supplierName','')))
    )
  then v_reason:='Numer paragonu i stacja odpowiadają wcześniejszemu tankowaniu.'; end if;

  -- Preserve a human-review path in existing Fleet AI waiting area.
  insert into public.fleet_document_reviews (
    workspace_id,document_id,document_version_id,project_id,source_module,
    document_type,document_number,document_date,registration_number,provider_name,
    amount,currency,fuel_liters,fuel_type,candidate_vehicle_id,confidence,status,
    decision_reason,raw_payload,updated_at
  ) values (
    p_workspace_id,p_document_id,v_extract.document_version_id,v_doc.project_id,'fleet',
    'fuel_receipt',nullif(v_business->>'documentNumber',''),v_date,
    nullif(v_line->>'vehicleRegistration',''),nullif(v_business->>'supplierName',''),
    v_amount,v_currency,v_liters,nullif(v_line->>'description',''),v_vehicle_id,
    coalesce(v_extract.confidence,0),'waiting',
    coalesce(v_reason,'AI dopasowało pojazd po numerze rejestracyjnym.'),
    v_payload,now()
  )
  on conflict(document_version_id) do update set
    document_type='fuel_receipt',
    registration_number=excluded.registration_number,
    provider_name=excluded.provider_name,
    amount=excluded.amount,currency=excluded.currency,
    fuel_liters=excluded.fuel_liters,
    candidate_vehicle_id=excluded.candidate_vehicle_id,
    decision_reason=excluded.decision_reason,updated_at=now()
  where public.fleet_document_reviews.status in ('waiting','ready')
  returning id into v_review_id;

  if v_reason is not null then
    return jsonb_build_object('needsReview',true,'reason',v_reason);
  end if;

  begin
    insert into public.fuel_entries (
      workspace_id,vehicle_id,project_id,fueled_at,liters,gross_amount,
      source_document_id,fuel_type,station_name,external_transaction_id
    ) values (
      p_workspace_id,v_vehicle_id,v_doc.project_id,v_date::timestamptz,
      v_liters,v_amount,p_document_id,coalesce(v_line->>'description','Paliwo'),
      nullif(v_business->>'supplierName',''),'octopus_fuel_receipt_20261030:' || p_document_id::text
    ) returning id into v_entry_id;

    insert into public.fleet_cost_links (
      workspace_id,vehicle_id,project_id,document_id,cost_type,amount,currency,
      occurred_at,source_type,source_id,notes
    ) values (
      p_workspace_id,v_vehicle_id,v_doc.project_id,p_document_id,'fuel',
      v_amount,v_currency,v_date,'fuel_receipt_auto',v_entry_id,
      'Paragon paliwowy: automatyczne dopasowanie dokładnej rejestracji, bez faktury VAT.'
    );
    update public.fleet_document_reviews
       set candidate_vehicle_id=v_vehicle_id,status='applied',applied_at=now(),
           decision_reason='Automatyczne dopasowanie jednoznacznego numeru rejestracyjnego.',
           updated_at=now()
     where workspace_id=p_workspace_id and document_version_id=v_extract.document_version_id
       and status in ('waiting','ready');
    insert into public.audit_events(workspace_id,actor_type,event_type,entity_type,entity_id,after_value)
      values(p_workspace_id,'system','fleet.fuel_receipt_auto_matched','fuel_entry',v_entry_id::text,
        jsonb_build_object('document_id',p_document_id,'vehicle_id',v_vehicle_id,'plate',v_plate,
          'liters',v_liters,'amount',v_amount));
    return jsonb_build_object('automatic',true,'fuelEntryId',v_entry_id);
  exception when others then
    update public.fleet_document_reviews
       set decision_reason='Automatyczny zapis paragonu wymaga ręcznej kontroli.',updated_at=now()
     where document_version_id=v_extract.document_version_id
       and workspace_id=p_workspace_id and status in ('waiting','ready');
    return jsonb_build_object('needsReview',true,'reason','booking_conflict');
  end;
end;
$$;

revoke all on function public.auto_assign_fuel_receipt_by_registration_20261030(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.auto_assign_fuel_receipt_by_registration_20261030(uuid,uuid)
 to service_role;
