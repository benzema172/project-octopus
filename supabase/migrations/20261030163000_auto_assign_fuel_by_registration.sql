-- Exact plate-to-vehicle auto assignment for AI-extracted fuel receipts/invoice lines.
-- Never infer a vehicle from supplier name, location, history or an ambiguous OCR token.
alter table public.fuel_purchase_reviews
  add column if not exists assignment_mode text not null default 'manual'
    check(assignment_mode in ('manual','automatic')),
  add column if not exists auto_plate text,
  add column if not exists auto_reason text;
create index if not exists fuel_purchase_reviews_automatic_idx
  on public.fuel_purchase_reviews(workspace_id,resolved_at desc)
  where status='assigned' and assignment_mode='automatic';

create or replace function private.normalize_fuel_plate_20261030(p_plate text)
returns text language sql immutable set search_path='' as $$
  select nullif(regexp_replace(upper(btrim(coalesce(p_plate,''))),'[^A-Z0-9]','','g'),'');
$$;
revoke all on function private.normalize_fuel_plate_20261030(text) from public,anon,authenticated;

-- Internal server call after the canonical invoice lines are committed.
-- Reuses the existing serialized, deduplicating financial-to-fleet booking RPC.
create or replace function public.auto_assign_fuel_by_registration_20261030(
  p_workspace_id uuid,p_document_id uuid
) returns jsonb language plpgsql security definer
set search_path='public','private','pg_temp' as $$
declare
  r record;
  v_plate text;
  v_match_count integer;
  v_vehicle_id uuid;
  v_liters numeric;
  v_booking_id uuid;
  v_auto integer:=0;
  v_waiting integer:=0;
  v_reason text;
begin
  if p_workspace_id is null or p_document_id is null then
    raise exception 'Brak firmy lub źródłowego dokumentu.';
  end if;
  perform 1 from public.documents d
    where d.id=p_document_id and d.workspace_id=p_workspace_id;
  if not found then raise exception 'Brak dokumentu w aktywnej firmie.'; end if;
  for r in
    select pr.id,pr.workspace_id,pr.invoice_line_id,
      l.description,l.quantity,l.unit,l.gross_amount,l.business_metadata,
      i.currency,i.id as invoice_id
    from public.fuel_purchase_reviews pr
    join public.invoices i on i.id=pr.invoice_id and i.workspace_id=pr.workspace_id
    join public.invoice_lines l on l.id=pr.invoice_line_id and l.invoice_id=i.id and l.workspace_id=pr.workspace_id
    where pr.workspace_id=p_workspace_id and i.document_id=p_document_id and pr.status='pending'
      and i.direction='purchase'
    order by pr.created_at,pr.id
    limit 250
  loop
    v_reason:=null;
    -- Metadata comes from the actual AI-structured invoice line. Never use
    -- the prefilled invoice_lines.vehicle_id, which may be a non-unique guess.
    v_plate:=private.normalize_fuel_plate_20261030(r.business_metadata->>'vehicleRegistration');
    if v_plate is null then
      v_reason:='Brak czytelnego numeru rejestracyjnego przy pozycji paliwowej.';
    elsif length(v_plate) < 4 or length(v_plate) > 9 then
      v_reason:='Numer rejestracyjny nie ma wiarygodnego formatu.';
    elsif not private.is_motor_fuel_line_20261030(r.description,null,r.business_metadata) then
      v_reason:='Pozycja nie jest jednoznacznym paliwem.';
    elsif upper(coalesce(r.currency,'PLN')) <> 'PLN' then
      v_reason:='Faktura walutowa wymaga ręcznego rozliczenia.';
    else
      select count(*)::int,min(v.id) into v_match_count,v_vehicle_id
      from public.vehicles v
      where v.workspace_id=p_workspace_id
        and v.status<>'sold'
        and private.normalize_fuel_plate_20261030(v.registration_number)=v_plate;
      if v_match_count <> 1 then
        v_reason:=case when v_match_count=0
          then 'Rejestracji nie znaleziono w tej firmie.'
          else 'Kilka pojazdów ma taką rejestrację. Wymagana decyzja.' end;
      end if;
    end if;
    v_liters:=coalesce(
      case when (r.business_metadata->>'liters') ~ '^[0-9]+([.][0-9]+)?$'
        and (r.business_metadata->>'liters')::numeric>0
        then (r.business_metadata->>'liters')::numeric end,
      case when lower(btrim(coalesce(r.unit,''))) in
         ('l','lt','ltr','litr','litry','litrow','litrów','dm3','dm³')
       and r.quantity>0 then r.quantity end
    );
    if v_reason is null and (v_liters is null or v_liters<=0 or v_liters>20000
        or r.gross_amount is null or r.gross_amount<=0 or r.gross_amount>1000000)
    then v_reason:='Niepewna liczba litrów lub kwota brutto — wymagane potwierdzenie.'; end if;
    if v_reason is null and exists(
      select 1 from public.fleet_cost_links fc
      where fc.workspace_id=p_workspace_id and fc.invoice_line_id=r.invoice_line_id
        and fc.vehicle_id<>v_vehicle_id
    ) then v_reason:='Pozycja jest przypisana do innego pojazdu w kosztach Floty.'; end if;
    if v_reason is null then
      begin
        v_booking_id:=public.resolve_fuel_purchase_review_20261030(
           p_workspace_id,r.id,v_vehicle_id,v_liters,r.gross_amount,'assign',null);
        update public.fuel_purchase_reviews
          set assignment_mode='automatic',auto_plate=v_plate,auto_reason='Jednoznaczny numer rejestracyjny rozpoznany przez AI.',
              updated_at=now()
          where id=r.id and workspace_id=p_workspace_id and status='assigned';
        insert into public.audit_events(workspace_id,actor_type,event_type,entity_type,entity_id,after_value)
        values(p_workspace_id,'system','fleet.fuel_auto_plate_matched','fuel_entry',v_booking_id::text,
          jsonb_build_object('review_id',r.id,'vehicle_id',v_vehicle_id,'plate',v_plate,
             'invoice_line_id',r.invoice_line_id));
        v_auto:=v_auto+1;
      exception when others then
        -- A duplicate or other operational conflict must never break document ingestion.
        update public.fuel_purchase_reviews set auto_reason='Wymagana ręczna kontrola zgodności tankowania.',
          updated_at=now() where id=r.id and status='pending';
        v_waiting:=v_waiting+1;
      end;
    else
      update public.fuel_purchase_reviews set auto_plate=v_plate,auto_reason=v_reason,
        updated_at=now() where id=r.id and status='pending';
      v_waiting:=v_waiting+1;
    end if;
  end loop;
  return jsonb_build_object('automatic',v_auto,'needsReview',v_waiting);
end;
$$;
revoke all on function public.auto_assign_fuel_by_registration_20261030(uuid,uuid) from public,anon,authenticated;
grant execute on function public.auto_assign_fuel_by_registration_20261030(uuid,uuid) to service_role;


-- A genuine fiscal receipt is a fleet cost, NOT an automatically fabricated VAT invoice.
-- One single, unambiguous fuel purchase is eligible for automatic booking.
create unique index if not exists fuel_entries_one_auto_receipt_20261030
  on public.fuel_entries(source_document_id)
  where source_document_id is not null
    and external_transaction_id='octopus_fuel_receipt_20261030';

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
begin
  select * into v_doc from public.documents
    where id=p_document_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Brak dokumentu firmy.'; end if;
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
      nullif(v_business->>'supplierName',''),'octopus_fuel_receipt_20261030'
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
