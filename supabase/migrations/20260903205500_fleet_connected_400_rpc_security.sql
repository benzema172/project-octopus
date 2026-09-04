begin;

-- Loadery Fleet 4.0 korzystają z service clienta. SECURITY DEFINER read-models nie są potrzebne klientowi.
revoke all on function public.get_fleet_connected_summary_400(uuid,integer) from public,anon,authenticated;
revoke all on function public.get_fleet_service_kit_shortages_400(uuid) from public,anon,authenticated;
grant execute on function public.get_fleet_connected_summary_400(uuid,integer) to service_role;
grant execute on function public.get_fleet_service_kit_shortages_400(uuid) to service_role;

insert into public.app_schema_versions(version)
values('20260903_fleet_connected_400_rpc_security')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
