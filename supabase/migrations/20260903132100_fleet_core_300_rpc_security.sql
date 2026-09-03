begin;

-- Fleet Core 3.0 RPC hardening.
-- KPI są ładowane wyłącznie przez serwerowy klient service_role, więc funkcja nie może być publicznym RPC.
revoke all on function public.get_fleet_core_summary_300(uuid,date) from public,anon,authenticated;
grant execute on function public.get_fleet_core_summary_300(uuid,date) to service_role;

insert into public.app_schema_versions(version)
values('20260903_fleet_core_300_rpc_security')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
