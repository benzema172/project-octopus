begin;

-- Fleet Core 3.0 foreign-key hardening.
-- Dedykowane, pełne indeksy zapewniają szybkie joiny i bezpieczne utrzymanie FK także dla wartości NULL.
create index if not exists vehicles_responsible_employee_fk_idx on public.vehicles(responsible_employee_id);
create index if not exists vehicles_default_project_fk_idx on public.vehicles(default_project_id);

create index if not exists meter_readings_source_document_fk_idx on public.meter_readings(source_document_id);
create index if not exists meter_readings_source_fuel_entry_fk_idx on public.meter_readings(source_fuel_entry_id);
create index if not exists meter_readings_source_service_order_fk_idx on public.meter_readings(source_service_order_id);
create index if not exists meter_readings_created_by_fk_idx on public.meter_readings(created_by);

create index if not exists fuel_entries_source_document_fk_idx on public.fuel_entries(source_document_id);

create index if not exists service_orders_workshop_counterparty_fk_idx on public.service_orders(workshop_counterparty_id);
create index if not exists service_orders_source_document_fk_full_idx on public.service_orders(source_document_id);

create index if not exists damage_cases_project_fk_full_idx on public.damage_cases(project_id);
create index if not exists damage_cases_repair_service_order_fk_idx on public.damage_cases(repair_service_order_id);

create index if not exists vehicle_service_items_stock_item_fk_idx on public.vehicle_service_items(stock_item_id);
create index if not exists vehicle_service_items_invoice_line_fk_idx on public.vehicle_service_items(invoice_line_id);

create index if not exists vehicle_checks_employee_fk_idx on public.vehicle_checks(employee_id);

create index if not exists fleet_document_reviews_project_fk_idx on public.fleet_document_reviews(project_id);
create index if not exists fleet_document_reviews_candidate_vehicle_fk_idx on public.fleet_document_reviews(candidate_vehicle_id);

create index if not exists fleet_ai_feedback_created_by_fk_idx on public.fleet_ai_feedback(created_by);
create index if not exists fleet_ai_decision_events_created_by_fk_idx on public.fleet_ai_decision_events(created_by);

create index if not exists fleet_anomalies_vehicle_fk_idx on public.fleet_anomalies(vehicle_id);
create index if not exists fleet_anomalies_resolved_by_fk_idx on public.fleet_anomalies(resolved_by);

create index if not exists fleet_cost_links_project_fk_idx on public.fleet_cost_links(project_id);
create index if not exists fleet_cost_links_employee_fk_idx on public.fleet_cost_links(employee_id);
create index if not exists fleet_cost_links_invoice_fk_idx on public.fleet_cost_links(invoice_id);
create index if not exists fleet_cost_links_invoice_line_fk_idx on public.fleet_cost_links(invoice_line_id);
create index if not exists fleet_cost_links_service_order_fk_idx on public.fleet_cost_links(service_order_id);
create index if not exists fleet_cost_links_damage_case_fk_idx on public.fleet_cost_links(damage_case_id);
create index if not exists fleet_cost_links_document_fk_idx on public.fleet_cost_links(document_id);

insert into public.app_schema_versions(version)
values('20260903_fleet_core_300_fk_index_hardening')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
