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
