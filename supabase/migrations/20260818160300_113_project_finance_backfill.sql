begin;

alter table public.projects add column if not exists contract_value numeric;
alter table public.projects add column if not exists currency char(3) default 'PLN';

insert into public.app_schema_versions(version)
values ('20260818_project_finance_backfill')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
