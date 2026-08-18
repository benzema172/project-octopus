begin;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typname='review_status'
  ) then
    create type public.review_status as enum ('draft','ai_ready','in_review','sent','approved','rejected','archived');
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='material_requests' and column_name='status'
      and not (data_type='USER-DEFINED' and udt_schema='public' and udt_name='review_status')
  ) then
    alter table public.material_requests alter column status drop default;
    alter table public.material_requests
      alter column status type public.review_status
      using status::public.review_status;
    alter table public.material_requests
      alter column status set default 'draft'::public.review_status;
  end if;
end;
$$;

insert into public.app_schema_versions(version)
values ('20260818_review_status_backfill')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
