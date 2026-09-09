begin;

-- Lifecycle RPCs are server-side entry points. Application routes and server
-- components call them through createServiceSupabaseClient() after normal
-- authentication and domain authorization. Keep SECURITY DEFINER functions
-- inaccessible to browser/client roles.
revoke all on function public.approve_project_output_atomic(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_project_output_atomic(uuid, uuid, uuid, uuid) to service_role;

revoke all on function public.archive_project_atomic(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.archive_project_atomic(uuid, uuid, uuid) to service_role;

revoke all on function public.get_project_lifecycle_readiness_540(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_project_lifecycle_readiness_540(uuid, uuid) to service_role;

-- Internal lifecycle helpers are used by database-side controls only and must
-- not become direct client RPCs.
revoke all on function public.project_is_operational(uuid) from public, anon, authenticated;
grant execute on function public.project_is_operational(uuid) to service_role;

revoke all on function public.guard_project_operational_write_540() from public, anon, authenticated;
grant execute on function public.guard_project_operational_write_540() to service_role;

commit;
