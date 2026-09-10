-- Ceny i dostawcy: jedna historia zakupu na pozycję faktury.
-- Zatwierdzenie PZ nadal tworzy warstwę kosztową i material_chain_event,
-- ale nie może tworzyć drugiej obserwacji ceny, jeżeli PZ pochodzi z tej samej pozycji faktury.
-- Kanonicznym źródłem ceny zakupowej jest wtedy price_observations(source_type='invoice_line').

create or replace function public.prevent_redundant_receipt_price_observation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_line_id uuid;
begin
  if new.source_type <> 'stock_movement_line' then
    return new;
  end if;

  select sml.source_invoice_line_id
    into v_invoice_line_id
  from public.stock_movement_lines sml
  where sml.id = new.source_id
    and sml.workspace_id = new.workspace_id;

  if v_invoice_line_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.price_observations canonical
    where canonical.workspace_id = new.workspace_id
      and canonical.source_type = 'invoice_line'
      and canonical.source_id = v_invoice_line_id
      and canonical.canonical_purchase = true
  ) then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_redundant_receipt_price_observation() from public;

drop trigger if exists trg_prevent_redundant_receipt_price_observation on public.price_observations;
create trigger trg_prevent_redundant_receipt_price_observation
before insert on public.price_observations
for each row
execute function public.prevent_redundant_receipt_price_observation();

-- Jeżeli kanoniczna cena z faktury pojawi się dopiero po wcześniejszym PZ,
-- usuń wtórną obserwację PZ powiązaną dokładnie z tą samą pozycją faktury.
create or replace function public.cleanup_redundant_receipt_price_after_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source_type = 'invoice_line' and new.canonical_purchase = true then
    delete from public.price_observations receipt
    using public.stock_movement_lines sml
    where receipt.workspace_id = new.workspace_id
      and receipt.source_type = 'stock_movement_line'
      and receipt.source_id = sml.id
      and sml.workspace_id = new.workspace_id
      and sml.source_invoice_line_id = new.source_id;
  end if;

  return new;
end;
$$;

revoke all on function public.cleanup_redundant_receipt_price_after_invoice() from public;

drop trigger if exists trg_cleanup_redundant_receipt_price_after_invoice on public.price_observations;
create trigger trg_cleanup_redundant_receipt_price_after_invoice
after insert or update of canonical_purchase, source_type, source_id on public.price_observations
for each row
execute function public.cleanup_redundant_receipt_price_after_invoice();

-- Backfill: usuń wyłącznie obserwacje PZ, dla których istnieje jednoznaczne
-- powiązanie source_invoice_line_id z kanoniczną obserwacją faktury.
-- Nie dotykamy ręcznych PZ ani PZ bez faktury.
delete from public.price_observations receipt
using public.stock_movement_lines sml
where receipt.source_type = 'stock_movement_line'
  and receipt.source_id = sml.id
  and receipt.workspace_id = sml.workspace_id
  and sml.source_invoice_line_id is not null
  and exists (
    select 1
    from public.price_observations canonical
    where canonical.workspace_id = receipt.workspace_id
      and canonical.source_type = 'invoice_line'
      and canonical.source_id = sml.source_invoice_line_id
      and canonical.canonical_purchase = true
  );