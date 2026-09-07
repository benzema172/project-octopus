begin;

-- These RPCs are server-only entry points. The application invokes them through
-- createServiceSupabaseClient() after its own authentication/authorization checks.
-- Keep SECURITY DEFINER functions inaccessible to browser/client roles.
revoke all on function public.approve_procurement_match_atomic(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_procurement_match_atomic(uuid, uuid, uuid) to service_role;

revoke all on function public.get_company_action_center_v3(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_company_action_center_v3(uuid, integer) to service_role;

revoke all on function public.get_company_operations_summary(uuid, text, date) from public, anon, authenticated;
grant execute on function public.get_company_operations_summary(uuid, text, date) to service_role;

revoke all on function public.get_company_operations_summary_v2(uuid, text, date) from public, anon, authenticated;
grant execute on function public.get_company_operations_summary_v2(uuid, text, date) to service_role;

revoke all on function public.refresh_operational_notifications_atomic(uuid) from public, anon, authenticated;
grant execute on function public.refresh_operational_notifications_atomic(uuid) to service_role;

commit;
