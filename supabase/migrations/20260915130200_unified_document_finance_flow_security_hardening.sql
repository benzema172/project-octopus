-- Security hardening for Unified Document & Finance Flow.
-- Keep the helper deterministic and remove role-dependent object resolution.

create or replace function public.octopus_invoice_identity_key(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select regexp_replace(lower(coalesce(p_value,'')), '[^a-z0-9]', '', 'g')
$$;