-- Fuel purchases from AI-parsed invoice lines: one review and at most one tanking per line.
-- No stock movements, invoice postings, VAT decisions or automatic vehicle assignments.
create table if not exists public.fuel_purchase_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  invoice_line_id uuid not null unique references public.invoice_lines(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','assigned','ignored')),
  suggested_fuel_type text,
  suggested_liters numeric,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  fuel_entry_id uuid references public.fuel_entries(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fuel_purchase_reviews_queue_idx
  on public.fuel_purchase_reviews(workspace_id,status,created_at desc);
create index if not exists fuel_purchase_reviews_invoice_idx
  on public.fuel_purchase_reviews(invoice_id);
create unique index if not exists fuel_entries_one_invoice_line_tanking_20261030
  on public.fuel_entries(invoice_line_id) where invoice_line_id is not null;
alter table public.fuel_purchase_reviews enable row level security;
revoke all on public.fuel_purchase_reviews from public,anon,authenticated;
grant select,insert,update,delete on public.fuel_purchase_reviews to service_role;

-- The AI extracts invoice line descriptions and types; this conservative post-check
-- recognizes actual motor fuel, not an arbitrary purchase from a fuel station.
create or replace function private.is_motor_fuel_line_20261030(
  p_description text, p_expense_category text, p_metadata jsonb
) returns boolean language plpgsql immutable set search_path='' as $fn$
declare
  v_text text := lower(translate(coalesce(p_description,''),'ĄĆĘŁŃÓŚŹŻąćęłńóśźż','ACELNOSZZacelnoszz'));
  v_tag text := lower(translate(coalesce(p_expense_category,'') || ' ' ||
    coalesce(p_metadata->>'fuelType','') || ' ' ||
    coalesce(p_metadata->>'expenseCategory',''),
    'ĄĆĘŁŃÓŚŹŻąćęłńóśźż','ACELNOSZZacelnoszz'));
begin
  if v_text ~ '(adblue|mocznik|olej silnikowy|olej hydrauliczny|olej przekladniowy|olej opalowy|plyn do spryskiwaczy|myjnia|rabat paliwow|oplata paliwow|karta paliwow)' then
    return false;
  end if;
  return v_text ~ '(^|[^a-z0-9])(benzyn[ay]|pb[ -]?(95|98)|95[ -]?e10|98[ -]?e5|olej napedowy|diesel|biodiesel|ropa|lpg|autogaz|cng|lng|paliwo|tankowanie|on)([^a-z0-9]|$)'
    or v_tag ~ '(^|[^a-z0-9])(fuel|paliwo|diesel|benzyna|lpg|olej napedowy)([^a-z0-9]|$)';
end;
$fn$;
revoke all on function private.is_motor_fuel_line_20261030(text,text,jsonb) from public,anon,authenticated;
grant execute on function private.is_motor_fuel_line_20261030(text,text,jsonb) to service_role;

create or replace function private.capture_motor_fuel_purchase_20261030()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_invoice public.invoices%rowtype;
        v_type text;
        v_liters numeric;
begin
  select * into v_invoice from public.invoices
   where id=new.invoice_id and workspace_id=new.workspace_id;
  if not found or v_invoice.direction <> 'purchase' then return new; end if;
  if not private.is_motor_fuel_line_20261030(new.description,new.expense_category,new.business_metadata) then
    delete from public.fuel_purchase_reviews
      where invoice_line_id=new.id and status='pending';
    return new;
  end if;
  if exists(select 1 from public.fuel_entries
    where workspace_id=new.workspace_id and invoice_line_id=new.id) then return new; end if;
  v_type:=case
    when new.description ~* '(pb[ -]?98|98[ -]?e5)' then 'PB98'
    when new.description ~* '(pb[ -]?95|95[ -]?e10|benzyn)' then 'PB95'
    when new.description ~* '(lpg|autogaz)' then 'LPG'
    when new.description ~* '(^|[^a-z])(cng)([^a-z]|$)' then 'CNG'
    when new.description ~* '(^|[^a-z])(lng)([^a-z]|$)' then 'LNG'
    when new.description ~* '(diesel|olej nap[eę]dowy|biodiesel|ropa|(^|[^a-z])on([^a-z]|$))' then 'ON'
    else 'Paliwo' end;
  v_liters:=case
    when lower(trim(coalesce(new.unit,''))) in ('l','lt','ltr','litr','litry','litrow','litrów','dm3','dm³')
      and new.quantity>0 then new.quantity
    else null end;
  insert into public.fuel_purchase_reviews
    (workspace_id,invoice_id,invoice_line_id,document_id,suggested_fuel_type,suggested_liters)
  values(new.workspace_id,new.invoice_id,new.id,v_invoice.document_id,v_type,v_liters)
  on conflict (invoice_line_id) do update set
    suggested_fuel_type=excluded.suggested_fuel_type,
    suggested_liters=excluded.suggested_liters,
    document_id=excluded.document_id,updated_at=now()
  where public.fuel_purchase_reviews.status='pending';
  return new;
end;
$fn$;
revoke all on function private.capture_motor_fuel_purchase_20261030() from public,anon,authenticated;

drop trigger if exists invoice_line_fuel_purchase_review_20261030 on public.invoice_lines;
create trigger invoice_line_fuel_purchase_review_20261030
after insert or update of description,quantity,unit,gross_amount,expense_category,business_metadata
on public.invoice_lines for each row execute function private.capture_motor_fuel_purchase_20261030();

-- Backfill recent structured purchases only; never replay booked tankings.
insert into public.fuel_purchase_reviews
  (workspace_id,invoice_id,invoice_line_id,document_id,suggested_fuel_type,suggested_liters)
select l.workspace_id,l.invoice_id,l.id,i.document_id,
       case
         when l.description ~* '(pb[ -]?98|98[ -]?e5)' then 'PB98'
         when l.description ~* '(pb[ -]?95|95[ -]?e10|benzyn)' then 'PB95'
         when l.description ~* '(lpg|autogaz)' then 'LPG'
         when l.description ~* '(diesel|olej nap[eę]dowy|biodiesel|ropa|(^|[^a-z])on([^a-z]|$))' then 'ON'
         else 'Paliwo' end,
       case when lower(trim(coalesce(l.unit,''))) in ('l','lt','ltr','litr','litry','litrow','litrów','dm3','dm³')
         and l.quantity>0 then l.quantity else null end
from public.invoice_lines l
join public.invoices i on i.id=l.invoice_id and i.workspace_id=l.workspace_id
where i.direction='purchase'
  and i.created_at>=now()-interval '180 days'
  and private.is_motor_fuel_line_20261030(l.description,l.expense_category,l.business_metadata)
  and not exists(select 1 from public.fuel_entries f where f.invoice_line_id=l.id)
on conflict(invoice_line_id) do nothing;

-- Transactional, idempotent link to a real fleet vehicle. Never create an
-- additional invoice or stock record and never autonomously approve accounting.
create or replace function public.resolve_fuel_purchase_review_20261030(
  p_workspace_id uuid,p_review_id uuid,p_vehicle_id uuid,
  p_liters numeric,p_amount numeric,p_action text,p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path='public','pg_temp' as $fn$
declare
  r public.fuel_purchase_reviews%rowtype;
  i public.invoices%rowtype;
  l public.invoice_lines%rowtype;
  v public.vehicles%rowtype;
  v_fuel_id uuid;
  v_liters numeric;
  v_amount numeric;
  v_project_id uuid;
begin
  select * into r from public.fuel_purchase_reviews
    where id=p_review_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Pozycja paliwowa nie należy do aktywnej firmy.'; end if;
  if r.status='assigned' then return r.fuel_entry_id; end if;
  if r.status<>'pending' then raise exception 'Pozycja jest już zamknięta.'; end if;
  if p_action='ignore' then
    update public.fuel_purchase_reviews
       set status='ignored',resolved_by=p_actor_id,resolved_at=now(),updated_at=now()
       where id=r.id;
    insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,after_value)
      values(p_workspace_id,p_actor_id,'fleet.fuel_purchase_ignored','fuel_purchase_review',r.id::text,'{}'::jsonb);
    return r.id;
  end if;
  if p_action<>'assign' then raise exception 'Nieznana operacja przypisania paliwa.'; end if;
  select * into v from public.vehicles where id=p_vehicle_id and workspace_id=p_workspace_id;
  if not found or v.status='sold' then raise exception 'Wybierz aktywny pojazd swojej firmy.'; end if;
  select * into i from public.invoices where id=r.invoice_id and workspace_id=p_workspace_id;
  if not found or i.direction<>'purchase' then raise exception 'Brak właściwej faktury zakupowej.'; end if;
  select * into l from public.invoice_lines
    where id=r.invoice_line_id and workspace_id=p_workspace_id and invoice_id=i.id for update;
  if not found or not private.is_motor_fuel_line_20261030(l.description,l.expense_category,l.business_metadata) then
    raise exception 'Pozycja nie jest potwierdzonym zakupem paliwa.'; end if;
  if upper(coalesce(i.currency,'PLN'))<>'PLN' then
    raise exception 'Faktura w walucie innej niż PLN wymaga osobnego rozliczenia kursu.'; end if;
  if exists(select 1 from public.fuel_entries f
    where f.workspace_id=p_workspace_id and f.invoice_line_id=l.id) then
    raise exception 'Tankowanie dla tej pozycji już istnieje.'; end if;
  -- Older Fleet AI approvals may have booked this source document without
  -- an invoice_line_id. Never re-book it from the new Wrzutnia queue.
  if i.document_id is not null and exists (
    select 1 from public.fuel_entries f
    where f.workspace_id=p_workspace_id and f.source_document_id=i.document_id
      and f.invoice_line_id is null
  ) then raise exception 'Ten dokument ma już tankowanie w starszej Poczekalni Floty. Sprawdź historię.'; end if;
  if exists(select 1 from public.fleet_cost_links c
      where c.workspace_id=p_workspace_id and c.invoice_id=i.id and c.invoice_line_id is null
        and lower(c.cost_type) like '%fuel%')
  then raise exception 'Faktura ma już ogólny koszt paliwa przypisany do pojazdu. Wymaga uzgodnienia, aby nie podwoić kosztu.'; end if;
  -- Same supplier, invoice number and issue date in a different imported invoice:
  -- hold for review instead of counting the purchase twice.
  if nullif(trim(coalesce(i.invoice_number,'')),'') is not null and exists (
    select 1 from public.invoices duplicate_invoice
    join public.fuel_entries fuel on fuel.invoice_id=duplicate_invoice.id and fuel.workspace_id=p_workspace_id
    where duplicate_invoice.workspace_id=p_workspace_id and duplicate_invoice.id<>i.id
      and duplicate_invoice.direction='purchase'
      and duplicate_invoice.counterparty_id is not distinct from i.counterparty_id
      and duplicate_invoice.issue_date is not distinct from i.issue_date
      and trim(duplicate_invoice.invoice_number)=trim(i.invoice_number)
  ) then raise exception 'Możliwa zduplikowana faktura paliwowa — wymaga kontroli.'; end if;

  v_liters:=coalesce(p_liters,r.suggested_liters);
  v_amount:=coalesce(p_amount,l.gross_amount);
  if v_liters is null or v_liters<=0 or v_liters>20000
     or v_amount is null or v_amount<=0 or v_amount>1000000 then
    raise exception 'Podaj rzeczywistą liczbę litrów i kwotę brutto z pozycji faktury.'; end if;

  select d.project_id into v_project_id from public.documents d
    where d.id=i.document_id and d.workspace_id=p_workspace_id;
  insert into public.fuel_entries(workspace_id,vehicle_id,project_id,fueled_at,liters,gross_amount,
    invoice_id,invoice_line_id,source_document_id,fuel_type,station_name)
  values(p_workspace_id,p_vehicle_id,v_project_id,
    coalesce(i.sale_date,i.issue_date,current_date)::timestamptz,
    v_liters,v_amount,i.id,l.id,i.document_id,r.suggested_fuel_type,
    (select c.name from public.counterparties c
       where c.id=i.counterparty_id and c.workspace_id=p_workspace_id))
  returning id into v_fuel_id;

  -- Existing invoice-linked fleet cost is reused, not duplicated.
  if exists(select 1 from public.fleet_cost_links
    where workspace_id=p_workspace_id and invoice_line_id=l.id) then
    update public.fleet_cost_links set vehicle_id=p_vehicle_id
      where workspace_id=p_workspace_id and invoice_line_id=l.id;
  else
    insert into public.fleet_cost_links(workspace_id,vehicle_id,project_id,invoice_id,invoice_line_id,
      document_id,cost_type,amount,currency,occurred_at,source_type,source_id,notes)
    values(p_workspace_id,p_vehicle_id,v_project_id,i.id,l.id,i.document_id,'fuel',v_amount,
      i.currency,coalesce(i.sale_date,i.issue_date,current_date),
      'fuel_entry',v_fuel_id,'Przypisanie tankowania z Wrzutni; bez nowego kosztu księgowego.');
  end if;
  update public.invoice_lines set vehicle_id=p_vehicle_id where id=l.id and workspace_id=p_workspace_id;
  update public.fuel_purchase_reviews
    set status='assigned',vehicle_id=p_vehicle_id,fuel_entry_id=v_fuel_id,
        resolved_by=p_actor_id,resolved_at=now(),updated_at=now()
    where id=r.id;
  insert into public.audit_events(workspace_id,actor_id,event_type,entity_type,entity_id,after_value)
    values(p_workspace_id,p_actor_id,'fleet.fuel_purchase_assigned','fuel_purchase_review',r.id::text,
      jsonb_build_object('invoice_id',i.id,'invoice_line_id',l.id,'vehicle_id',p_vehicle_id,
        'fuel_entry_id',v_fuel_id,'liters',v_liters,'gross_amount',v_amount));
  return v_fuel_id;
end;
$fn$;
revoke all on function public.resolve_fuel_purchase_review_20261030(uuid,uuid,uuid,numeric,numeric,text,uuid)
  from public,anon,authenticated;
grant execute on function public.resolve_fuel_purchase_review_20261030(uuid,uuid,uuid,numeric,numeric,text,uuid)
  to service_role;
