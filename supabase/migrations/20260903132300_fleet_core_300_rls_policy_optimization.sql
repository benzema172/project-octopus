begin;

-- Fleet Core 3.0 — optymalizacja RLS po produkcyjnym audycie Supabase.
-- Osobny SELECT + INSERT/UPDATE/DELETE usuwa podwójne permissive policies dla odczytu,
-- zachowując identyczny model dostępu domenowego Floty.
do $$
declare
  t text;
begin
  foreach t in array array[
    'vehicle_service_plans','vehicle_service_items','vehicle_components','vehicle_required_qualifications','vehicle_checks',
    'fleet_document_reviews','fleet_ai_feedback','fleet_ai_decision_events','fleet_anomalies','fleet_cost_links'
  ] loop
    execute format('drop policy if exists %I on public.%I', t||'_write', t);

    execute format('drop policy if exists %I on public.%I', t||'_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check(private.has_domain_access(workspace_id,''fleet'',''write'',null))',
      t||'_insert', t
    );

    execute format('drop policy if exists %I on public.%I', t||'_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using(private.has_domain_access(workspace_id,''fleet'',''write'',null)) with check(private.has_domain_access(workspace_id,''fleet'',''write'',null))',
      t||'_update', t
    );

    execute format('drop policy if exists %I on public.%I', t||'_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using(private.has_domain_access(workspace_id,''fleet'',''write'',null))',
      t||'_delete', t
    );
  end loop;
end $$;

-- Stary rdzeń Floty miał FK szkoda -> pojazd bez pełnego indeksu. Domykamy go razem z audytem Fleet 3.0.
create index if not exists damage_cases_vehicle_fk_idx on public.damage_cases(vehicle_id);

insert into public.app_schema_versions(version)
values('20260903_fleet_core_300_rls_policy_optimization')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
