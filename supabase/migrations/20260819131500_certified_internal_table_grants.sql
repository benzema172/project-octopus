begin;

-- Certified audit: internal migration/legacy tables stay behind RLS and are
-- not part of the browser-facing Data API surface.
revoke all privileges on table public.app_schema_versions from anon, authenticated;
grant select, insert, update, delete on table public.app_schema_versions to service_role;

-- project_members existed only on older production schemas. Keep the cleanup
-- migration portable when rebuilding a current database from scratch.
do $do$
begin
  if to_regclass('public.project_members') is not null then
    execute 'revoke all privileges on table public.project_members from anon, authenticated';
    execute 'grant select, insert, update, delete on table public.project_members to service_role';
  end if;
end
$do$;

insert into public.app_schema_versions(version)
values ('20260819_certified_internal_table_grants')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
