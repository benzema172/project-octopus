-- Reproduce the live execution schedule shape on a fresh database without removing legacy columns.
alter table public.schedule_items add column if not exists system_id uuid;
alter table public.schedule_items add column if not exists boq_item_id uuid;
alter table public.schedule_items add column if not exists start_date date;
alter table public.schedule_items add column if not exists end_date date;
alter table public.schedule_items add column if not exists progress_percent numeric not null default 0;
alter table public.schedule_items add column if not exists dependency_ids uuid[] not null default '{}'::uuid[];
alter table public.schedule_items add column if not exists planned_value numeric;
alter table public.schedule_items add column if not exists actual_value numeric;
alter table public.schedule_items add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='schedule_items' and column_name='starts_on') then
    execute 'update public.schedule_items set start_date=coalesce(start_date,starts_on) where start_date is null';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='schedule_items' and column_name='ends_on') then
    execute 'update public.schedule_items set end_date=coalesce(end_date,ends_on) where end_date is null';
  end if;
end $$;

insert into public.app_schema_versions(version)
values('20260819_schedule_runtime_backfill')
on conflict(version) do nothing;
