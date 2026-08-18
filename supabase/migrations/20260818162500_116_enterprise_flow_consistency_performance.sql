begin;

create index if not exists accounting_entries_workspace_status_idx
  on public.accounting_entries(workspace_id,status,created_at desc);
create index if not exists procurement_matches_workspace_status_idx
  on public.procurement_matches(workspace_id,status,updated_at desc);
create index if not exists process_deviations_workspace_status_idx
  on public.process_deviations(workspace_id,status,created_at desc);

create or replace function public.get_company_enterprise_flow_summary(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
select jsonb_build_object(
  'inboxOpen', (select count(*) from public.business_inbox_items where workspace_id=p_workspace_id and status not in ('processed','ignored')),
  'accountingProposed', (select count(*) from public.accounting_entries where workspace_id=p_workspace_id and status='proposed'),
  'matchingReview', (select count(*) from public.procurement_matches where workspace_id=p_workspace_id and status='review'),
  'matchingOk', (select count(*) from public.procurement_matches where workspace_id=p_workspace_id and status in ('matched','approved')),
  'deviationsOpen', (select count(*) from public.process_deviations where workspace_id=p_workspace_id and status='open')
);
$$;
revoke all on function public.get_company_enterprise_flow_summary(uuid) from public,anon,authenticated;
grant execute on function public.get_company_enterprise_flow_summary(uuid) to service_role;

create or replace function public.protect_exported_accounting_entry()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='DELETE' and old.exported_at is not null then
    raise exception 'Wyeksportowany dekret jest zamrożony. Użyj korekty lub storna zamiast zmiany historii.';
  end if;
  if tg_op='UPDATE' and old.exported_at is not null then
    raise exception 'Wyeksportowany dekret jest zamrożony. Użyj korekty lub storna zamiast zmiany historii.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists accounting_entries_export_freeze on public.accounting_entries;
create trigger accounting_entries_export_freeze
before update or delete on public.accounting_entries
for each row execute function public.protect_exported_accounting_entry();

create or replace function public.protect_exported_accounting_line()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_entry_id uuid:=case when tg_op='DELETE' then old.entry_id else new.entry_id end;
begin
  if exists(select 1 from public.accounting_entries where id=v_entry_id and exported_at is not null) then
    raise exception 'Pozycje wyeksportowanego dekretu są zamrożone. Użyj korekty lub storna.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists accounting_entry_lines_export_freeze on public.accounting_entry_lines;
create trigger accounting_entry_lines_export_freeze
before insert or update or delete on public.accounting_entry_lines
for each row execute function public.protect_exported_accounting_line();

create or replace function public.protect_exported_invoice_allocation()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_workspace_id uuid;
  v_source_type text;
  v_source_id uuid;
begin
  if tg_op in ('UPDATE','DELETE') and old.source_type='invoice' and old.source_id is not null and exists(
    select 1 from public.accounting_entries ae
    where ae.workspace_id=old.workspace_id and ae.invoice_id=old.source_id and ae.exported_at is not null
  ) then
    raise exception 'Faktura ma wyeksportowany dekret. Jej alokacja kosztu jest zamrożona; użyj korekty lub storna.';
  end if;

  if tg_op in ('INSERT','UPDATE') and new.source_type='invoice' and new.source_id is not null and exists(
    select 1 from public.accounting_entries ae
    where ae.workspace_id=new.workspace_id and ae.invoice_id=new.source_id and ae.exported_at is not null
  ) then
    raise exception 'Faktura ma wyeksportowany dekret. Jej alokacja kosztu jest zamrożona; użyj korekty lub storna.';
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists financial_allocations_export_freeze on public.financial_allocations;
create trigger financial_allocations_export_freeze
before insert or update or delete on public.financial_allocations
for each row execute function public.protect_exported_invoice_allocation();

insert into public.app_schema_versions(version)
values ('20260818_enterprise_flow_consistency_performance')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
