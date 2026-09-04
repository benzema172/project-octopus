begin;

-- Fleet 4.0 — pełne indeksowanie kolumn FK wykryte przez kontrakt migracji.
-- Kontrakt produkcyjny wymaga indeksów nieczęściowych, aby planner miał stabilną ścieżkę także dla zmian wartości NULL.
create index if not exists fleet_ai_recommendations_project_fk_idx on public.fleet_ai_recommendations(project_id);
create index if not exists fleet_ai_recommendations_resolved_by_fk_idx on public.fleet_ai_recommendations(resolved_by);
create index if not exists fleet_ai_recommendations_vehicle_fk_idx on public.fleet_ai_recommendations(vehicle_id);
create index if not exists fleet_camera_events_connection_fk_idx on public.fleet_camera_events(connection_id);
create index if not exists fleet_camera_events_document_fk_idx on public.fleet_camera_events(document_id);
create index if not exists fleet_camera_events_employee_fk_idx on public.fleet_camera_events(employee_id);
create index if not exists fleet_diagnostics_events_connection_fk_idx on public.fleet_diagnostics_events(connection_id);
create index if not exists fleet_diagnostics_events_device_fk_idx on public.fleet_diagnostics_events(device_id);
create index if not exists fleet_driver_behavior_events_connection_fk_idx on public.fleet_driver_behavior_events(connection_id);
create index if not exists fleet_driver_behavior_events_employee_fk_idx on public.fleet_driver_behavior_events(employee_id);
create index if not exists fleet_ev_charge_sessions_connection_fk_idx on public.fleet_ev_charge_sessions(connection_id);
create index if not exists fleet_ev_charge_sessions_project_fk_idx on public.fleet_ev_charge_sessions(project_id);
create index if not exists fleet_geofence_visits_project_fk_idx on public.fleet_geofence_visits(project_id);
create index if not exists fleet_geofences_created_by_fk_idx on public.fleet_geofences(created_by);
create index if not exists fleet_geofences_project_fk_idx on public.fleet_geofences(project_id);
create index if not exists fleet_incident_evidence_document_fk_idx on public.fleet_incident_evidence(document_id);
create index if not exists fleet_incident_vaults_employee_fk_idx on public.fleet_incident_vaults(employee_id);
create index if not exists fleet_incident_vaults_generated_document_fk_idx on public.fleet_incident_vaults(generated_bundle_document_id);
create index if not exists fleet_incident_vaults_project_fk_idx on public.fleet_incident_vaults(project_id);
create index if not exists fleet_mission_candidates_employee_fk_idx on public.fleet_mission_candidates(employee_id);
create index if not exists fleet_missions_created_by_fk_idx on public.fleet_missions(created_by);
create index if not exists fleet_missions_project_fk_idx on public.fleet_missions(project_id);
create index if not exists fleet_missions_employee_fk_idx on public.fleet_missions(selected_employee_id);
create index if not exists fleet_missions_vehicle_fk_idx on public.fleet_missions(selected_vehicle_id);
create index if not exists fleet_positions_connection_fk_idx on public.fleet_positions(connection_id);
create index if not exists fleet_positions_device_fk_idx on public.fleet_positions(device_id);
create index if not exists fleet_regulatory_events_employee_fk_idx on public.fleet_regulatory_events(employee_id);
create index if not exists fleet_route_plans_created_by_fk_idx on public.fleet_route_plans(created_by);
create index if not exists fleet_route_plans_employee_fk_idx on public.fleet_route_plans(employee_id);
create index if not exists fleet_route_plans_mission_fk_idx on public.fleet_route_plans(mission_id);
create index if not exists fleet_route_plans_vehicle_fk_idx on public.fleet_route_plans(vehicle_id);
create index if not exists fleet_route_stops_geofence_fk_idx on public.fleet_route_stops(geofence_id);
create index if not exists fleet_route_stops_project_fk_idx on public.fleet_route_stops(project_id);
create index if not exists fleet_service_kit_items_stock_fk_idx on public.fleet_service_kit_items(stock_item_id);
create index if not exists fleet_service_kits_vehicle_fk_idx on public.fleet_service_kits(vehicle_id);
create index if not exists fleet_telematics_connections_created_by_fk_idx on public.fleet_telematics_connections(created_by);
create index if not exists fleet_vehicle_checkouts_checkout_inspection_fk_idx on public.fleet_vehicle_checkouts(checkout_inspection_id);
create index if not exists fleet_vehicle_checkouts_created_by_fk_idx on public.fleet_vehicle_checkouts(created_by);
create index if not exists fleet_vehicle_checkouts_project_fk_idx on public.fleet_vehicle_checkouts(project_id);
create index if not exists fleet_vehicle_checkouts_return_inspection_fk_idx on public.fleet_vehicle_checkouts(return_inspection_id);
create index if not exists fleet_vehicle_checkouts_vehicle_fk_idx on public.fleet_vehicle_checkouts(vehicle_id);
create index if not exists fleet_walkaround_findings_document_fk_idx on public.fleet_walkaround_findings(evidence_document_id);
create index if not exists fleet_walkaround_inspections_baseline_fk_idx on public.fleet_walkaround_inspections(baseline_inspection_id);
create index if not exists fleet_walkaround_inspections_created_by_fk_idx on public.fleet_walkaround_inspections(created_by);
create index if not exists fleet_walkaround_inspections_document_fk_idx on public.fleet_walkaround_inspections(document_id);
create index if not exists fleet_walkaround_inspections_employee_fk_idx on public.fleet_walkaround_inspections(employee_id);
create index if not exists fleet_warranty_claims_document_fk_idx on public.fleet_warranty_claims(document_id);
create index if not exists fleet_warranty_claims_generated_document_fk_idx on public.fleet_warranty_claims(generated_claim_document_id);
create index if not exists fleet_warranty_claims_service_order_fk_idx on public.fleet_warranty_claims(service_order_id);
create index if not exists fuel_entries_telematics_connection_fk_idx on public.fuel_entries(telematics_connection_id);

insert into public.app_schema_versions(version)
values('20260903_fleet_connected_400_fk_indexes')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
