begin;

-- Certified audit: legacy table superseded by workspace_members.
-- Production verification before removal: 0 rows and no FK/trigger/policy/function dependencies.
drop table if exists public.project_members cascade;

insert into public.app_schema_versions(version)
values ('20260819_certified_drop_legacy_project_members')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
