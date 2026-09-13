-- Safe index cleanup found by the 2026-09-13 performance audit.
-- fleet_regulatory_profiles_vehicle_id_key already provides the same leading btree key and can serve
-- all lookup/FK access paths covered by fleet_regulatory_profiles_vehicle_idx.
drop index if exists public.fleet_regulatory_profiles_vehicle_idx;
