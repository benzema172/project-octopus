begin;

revoke all on function public.undo_fleet_ai_decision_300(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.undo_fleet_ai_decision_300(uuid,uuid,uuid) to service_role;
drop function if exists public.undo_fleet_ai_decision_300(uuid,uuid,uuid,uuid);

insert into public.schema_versions(version) values('20260903_fleet_core_300_security_hardening') on conflict(version) do nothing;

commit;
