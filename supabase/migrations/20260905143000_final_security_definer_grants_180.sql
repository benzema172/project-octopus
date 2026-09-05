-- Final security hardening: these atomic HR functions are invoked only from
-- authenticated server routes through the service-role Supabase client.
-- They must never be directly executable through the public REST RPC surface.

revoke all on function public.create_hr_employee_bundle_atomic(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.create_hr_employee_bundle_atomic(uuid, uuid, jsonb)
to service_role;

revoke all on function public.update_hr_employee_bundle_atomic(uuid, uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.update_hr_employee_bundle_atomic(uuid, uuid, uuid, uuid, jsonb)
to service_role;
