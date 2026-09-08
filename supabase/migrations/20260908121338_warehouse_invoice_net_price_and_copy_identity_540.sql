create table if not exists public.invoice_source_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  source_role text not null default 'canonical' check (source_role in ('canonical','copy','conflict')),
  comparison_status text not null default 'matched' check (comparison_status in ('matched','conflict')),
  comparison_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(invoice_id, document_id)
);

create index if not exists invoice_source_documents_workspace_idx on public.invoice_source_documents(workspace_id);
create index if not exists invoice_source_documents_document_idx on public.invoice_source_documents(document_id);
alter table public.invoice_source_documents enable row level security;
revoke all on table public.invoice_source_documents from public, anon, authenticated;
grant select, insert, update, delete on table public.invoice_source_documents to service_role;

insert into public.invoice_source_documents(workspace_id, invoice_id, document_id, source_role, comparison_status, comparison_details)
select i.workspace_id, i.id, i.document_id, 'canonical', 'matched', jsonb_build_object('backfilled', true)
from public.invoices i
where i.document_id is not null
on conflict(invoice_id, document_id) do nothing;

create or replace function private.invoice_source_document_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.document_id is not null then
    insert into public.invoice_source_documents(workspace_id, invoice_id, document_id, source_role, comparison_status, comparison_details, updated_at)
    values(new.workspace_id, new.id, new.document_id, 'canonical', 'matched', jsonb_build_object('trackedBy','invoice_trigger'), now())
    on conflict(invoice_id, document_id) do update set updated_at=excluded.updated_at;
  end if;
  return new;
end;
$$;
revoke all on function private.invoice_source_document_touch() from public, anon, authenticated;

drop trigger if exists invoices_source_document_touch_trg on public.invoices;
create trigger invoices_source_document_touch_trg
after insert or update of document_id on public.invoices
for each row execute function private.invoice_source_document_touch();

-- invoice_lines.unit_price jest zawsze ceną jednostkową NETTO. AI może się pomylić,
-- ale baza nie ufa polu unitPrice, jeżeli zna kwotę netto i ilość.
create or replace function private.canonicalize_invoice_line_net_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.quantity is not null and new.quantity <> 0 and new.net_amount is not null then
    new.unit_price := round((new.net_amount / new.quantity)::numeric, 6);
    new.business_metadata := coalesce(new.business_metadata, '{}'::jsonb)
      || jsonb_build_object('unitPriceBasis','net_amount_per_quantity');
  end if;
  return new;
end;
$$;
revoke all on function private.canonicalize_invoice_line_net_unit() from public, anon, authenticated;

drop trigger if exists invoice_lines_canonical_net_unit_trg on public.invoice_lines;
create trigger invoice_lines_canonical_net_unit_trg
before insert or update of quantity, net_amount, unit_price on public.invoice_lines
for each row execute function private.canonicalize_invoice_line_net_unit();

-- Druga, niezależna bariera: obserwacja cenowa z pozycji faktury dziedziczy cenę
-- NETTO z kanonicznej pozycji. Dzięki temu nawet starsza wersja RPC nie zapisze brutto
-- do unit_price_net.
create or replace function private.canonicalize_invoice_price_observation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_price_net numeric;
  v_quantity numeric;
  v_unit text;
begin
  if new.source_type='invoice_line' and new.source_id is not null then
    select
      round((il.net_amount / nullif(il.quantity,0))::numeric, 6),
      il.quantity,
      il.unit
    into v_unit_price_net, v_quantity, v_unit
    from public.invoice_lines il
    where il.id=new.source_id;

    if v_unit_price_net is not null then
      new.unit_price_net := v_unit_price_net;
      new.quantity := coalesce(new.quantity, v_quantity);
      new.unit := coalesce(new.unit, v_unit);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.canonicalize_invoice_price_observation() from public, anon, authenticated;

drop trigger if exists price_observations_canonical_invoice_net_trg on public.price_observations;
create trigger price_observations_canonical_invoice_net_trg
before insert or update of source_type, source_id, unit_price_net, quantity, unit on public.price_observations
for each row execute function private.canonicalize_invoice_price_observation();

-- Jedna faktura biznesowa może mieć kilka plików źródłowych (oryginał/kopia/skan).
-- Deduplikacja jest po tożsamości biznesowej, nie po document_id.
do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.upsert_canonical_business_document_atomic(uuid,uuid,uuid,uuid,jsonb,uuid,text,text)'::regprocedure)
    into v_def;

  v_old := $old$
  if v_invoice is null and nullif(trim(p_business->>'ksefNumber'),'') is not null then select id into v_invoice from public.invoices where workspace_id=p_workspace_id and ksef_number=p_business->>'ksefNumber' order by created_at limit 1; end if;
  if v_invoice is not null then
$old$;
  v_new := $new$
  if v_invoice is null and nullif(trim(p_business->>'ksefNumber'),'') is not null then select id into v_invoice from public.invoices where workspace_id=p_workspace_id and ksef_number=p_business->>'ksefNumber' order by created_at limit 1; end if;
  if v_invoice is null then
    select i.id into v_invoice
    from public.invoices i
    where i.workspace_id=p_workspace_id
      and i.direction=v_direction
      and regexp_replace(lower(coalesce(i.invoice_number,'')),'[^a-z0-9]','','g')=regexp_replace(lower(coalesce(v_number,'')),'[^a-z0-9]','','g')
      and i.counterparty_id is not distinct from v_counterparty
      and i.issue_date is not distinct from v_issue
    order by i.created_at
    limit 1;
  end if;
  if v_invoice is not null and p_document_id is not null and exists(
    select 1 from public.invoices i where i.id=v_invoice and i.document_id is distinct from p_document_id
  ) then
    insert into public.invoice_source_documents(workspace_id,invoice_id,document_id,source_role,comparison_status,comparison_details,updated_at)
    select p_workspace_id,v_invoice,p_document_id,
      case when abs(coalesce(i.net_amount,0)-v_net)<=0.02 and abs(coalesce(i.gross_amount,0)-v_gross)<=0.02 then 'copy' else 'conflict' end,
      case when abs(coalesce(i.net_amount,0)-v_net)<=0.02 and abs(coalesce(i.gross_amount,0)-v_gross)<=0.02 then 'matched' else 'conflict' end,
      jsonb_build_object(
        'canonicalDocumentId',i.document_id,
        'incomingDocumentId',p_document_id,
        'canonicalNet',i.net_amount,'incomingNet',v_net,
        'canonicalGross',i.gross_amount,'incomingGross',v_gross,
        'invoiceNumber',i.invoice_number,'issueDate',i.issue_date,
        'sourceChannel',p_source_channel
      ),now()
    from public.invoices i where i.id=v_invoice
    on conflict(invoice_id,document_id) do update set
      source_role=excluded.source_role,comparison_status=excluded.comparison_status,
      comparison_details=excluded.comparison_details,updated_at=now();

    insert into public.audit_events(workspace_id,actor_id,actor_type,event_type,entity_type,entity_id,after_value)
    select p_workspace_id,p_actor_id,'ai',
      case when isd.comparison_status='matched' then 'business_document.duplicate_source_matched' else 'business_document.duplicate_source_conflict' end,
      'invoice',v_invoice::text,
      jsonb_build_object('documentId',p_document_id,'comparisonStatus',isd.comparison_status,'details',isd.comparison_details)
    from public.invoice_source_documents isd where isd.invoice_id=v_invoice and isd.document_id=p_document_id;

    return jsonb_build_object(
      'invoiceId',v_invoice,'documentId',p_document_id,'duplicateSource',true,
      'comparisonStatus',(select comparison_status from public.invoice_source_documents where invoice_id=v_invoice and document_id=p_document_id),
      'canonicalVersion','business-document-v2'
    );
  end if;
  if v_invoice is not null then
$new$;
  if position(v_old in v_def)=0 then raise exception 'Nie znaleziono punktu wstawienia deduplikacji faktury.'; end if;
  v_def := replace(v_def,v_old,v_new);

  -- Ten krótki anchor jest stabilny między pełnym łańcuchem migracji a produkcją.
  -- Odrzuca drugą identyczną logicznie pozycję tej samej faktury, niezależnie od tego,
  -- czy AI nazwało jej unitPrice brutto czy netto.
  v_old := $old$v_key:=public.normalize_material_key(v_desc); v_stock:=null;$old$;
  v_new := $new$v_key:=public.normalize_material_key(v_desc); v_stock:=null;
    if exists(
      select 1 from public.invoice_lines il
      where il.invoice_id=v_invoice
        and il.line_number<>v_line_no
        and il.normalized_material_key=v_key
        and abs(coalesce(il.quantity,0)-coalesce(v_qty,0))<0.0001
        and abs(coalesce(il.net_amount,0)-coalesce(v_line_net,0))<0.01
        and abs(coalesce(il.gross_amount,0)-coalesce(v_line_gross,0))<0.01
    ) then
      v_seen:=array_remove(v_seen,v_line_no);
      continue;
    end if;$new$;
  if position(v_old in v_def)=0 then raise exception 'Nie znaleziono stabilnego punktu deduplikacji pozycji faktury.'; end if;
  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end;
$$;

-- Historyczna korekta pewnego przypadku: ta sama pozycja faktury zapisana raz brutto/szt. i raz netto/szt.
do $$
declare
  r record;
begin
  for r in
    with candidates as (
      select n.invoice_id,n.id keeper_id,g.id duplicate_id,n.stock_item_id,
             round((n.net_amount/nullif(n.quantity,0))::numeric,6) canonical_unit
      from public.invoice_lines n
      join public.invoice_lines g on g.invoice_id=n.invoice_id and g.id<>n.id
        and g.normalized_material_key=n.normalized_material_key
        and abs(coalesce(g.quantity,0)-coalesce(n.quantity,0))<0.0001
        and abs(coalesce(g.net_amount,0)-coalesce(n.net_amount,0))<0.01
        and abs(coalesce(g.gross_amount,0)-coalesce(n.gross_amount,0))<0.01
      where n.quantity<>0
        and abs(n.unit_price-(n.net_amount/n.quantity))<0.02
        and abs(g.unit_price-(g.gross_amount/g.quantity))<0.02
        and abs((g.gross_amount/g.quantity)-(n.net_amount/n.quantity))>=0.02
        and not exists(select 1 from public.procurement_matches pm where pm.invoice_line_id=g.id and pm.status='approved')
        and not exists(select 1 from public.financial_allocations fa where fa.source_line_id=g.id and fa.allocation_source<>'automatic' and fa.status in ('proposed','approved'))
        and not exists(select 1 from public.stock_movement_lines sml join public.stock_movements sm on sm.id=sml.movement_id where sml.source_invoice_line_id=g.id and sm.status<>'draft')
        and not exists(select 1 from public.accounting_entry_lines ael join public.accounting_entries ae on ae.id=ael.entry_id where ael.invoice_line_id=g.id and ae.exported_at is not null)
    ) select distinct on (duplicate_id) * from candidates order by duplicate_id,keeper_id
  loop
    delete from public.accounting_entry_lines where invoice_line_id=r.duplicate_id;
    delete from public.procurement_matches where invoice_line_id=r.duplicate_id and status<>'approved';
    delete from public.price_observations where source_type='invoice_line' and source_id=r.duplicate_id;
    delete from public.financial_allocations where source_line_id=r.duplicate_id and allocation_source='automatic';
    delete from public.stock_movement_lines d
      where d.source_invoice_line_id=r.duplicate_id
        and exists(select 1 from public.stock_movement_lines k where k.movement_id=d.movement_id and k.source_invoice_line_id=r.keeper_id);
    update public.stock_movement_lines set source_invoice_line_id=r.keeper_id,unit_cost=r.canonical_unit where source_invoice_line_id=r.duplicate_id;
    update public.fleet_cost_links set invoice_line_id=r.keeper_id where invoice_line_id=r.duplicate_id;
    update public.fuel_entries set invoice_line_id=r.keeper_id where invoice_line_id=r.duplicate_id;
    update public.vehicle_service_items set invoice_line_id=r.keeper_id where invoice_line_id=r.duplicate_id;
    delete from public.invoice_lines where id=r.duplicate_id;
    update public.invoice_lines set unit_price=r.canonical_unit where id=r.keeper_id;
    update public.price_observations set unit_price_net=r.canonical_unit where source_type='invoice_line' and source_id=r.keeper_id;
    update public.procurement_matches set invoiced_unit_price=r.canonical_unit where invoice_line_id=r.keeper_id;
  end loop;
end;
$$;
