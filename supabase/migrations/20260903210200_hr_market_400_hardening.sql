begin;

-- Kadry 4.0 — pełne indeksy FK wymagane przez kontrakt produkcyjny.
create index if not exists hr_job_requisitions_project_fk400_idx on public.hr_job_requisitions(project_id);
create index if not exists hr_job_requisitions_created_by_fk400_idx on public.hr_job_requisitions(created_by);
create index if not exists hr_job_requisitions_approved_by_fk400_idx on public.hr_job_requisitions(approved_by);

create index if not exists hr_candidates_requisition_fk400_idx on public.hr_candidates(requisition_id);
create index if not exists hr_candidates_document_fk400_idx on public.hr_candidates(cv_document_id);
create index if not exists hr_candidates_created_by_fk400_idx on public.hr_candidates(created_by);

create index if not exists hr_candidate_events_interviewer_fk400_idx on public.hr_candidate_events(interviewer_employee_id);
create index if not exists hr_candidate_events_created_by_fk400_idx on public.hr_candidate_events(created_by);

create index if not exists hr_lifecycle_tasks_responsible_fk400_idx on public.hr_lifecycle_tasks(responsible_employee_id);
create index if not exists hr_lifecycle_tasks_asset_fk400_idx on public.hr_lifecycle_tasks(asset_instance_id);
create index if not exists hr_lifecycle_tasks_document_fk400_idx on public.hr_lifecycle_tasks(document_id);
create index if not exists hr_lifecycle_tasks_created_by_fk400_idx on public.hr_lifecycle_tasks(created_by);

create index if not exists hr_business_trips_project_fk400_idx on public.hr_business_trips(project_id);
create index if not exists hr_business_trips_vehicle_fk400_idx on public.hr_business_trips(vehicle_id);
create index if not exists hr_business_trips_approved_by_fk400_idx on public.hr_business_trips(approved_by);
create index if not exists hr_business_trips_created_by_fk400_idx on public.hr_business_trips(created_by);

create index if not exists hr_trip_expenses_document_fk400_idx on public.hr_business_trip_expenses(document_id);
create index if not exists hr_employee_competencies_document_fk400_idx on public.hr_employee_competencies(evidence_document_id);

create index if not exists hr_training_plans_employee_fk400_idx on public.hr_training_plans(employee_id);
create index if not exists hr_training_plans_competency_fk400_idx on public.hr_training_plans(competency_id);
create index if not exists hr_training_plans_document_fk400_idx on public.hr_training_plans(document_id);
create index if not exists hr_training_plans_created_by_fk400_idx on public.hr_training_plans(created_by);

create index if not exists hr_performance_cycles_created_by_fk400_idx on public.hr_performance_cycles(created_by);
create index if not exists hr_goals_cycle_fk400_idx on public.hr_goals(cycle_id);
create index if not exists hr_performance_reviews_reviewer_fk400_idx on public.hr_performance_reviews(reviewer_employee_id);
create index if not exists hr_workforce_demands_created_by_fk400_idx on public.hr_workforce_demands(created_by);

create index if not exists hr_compensation_events_approved_by_fk400_idx on public.hr_compensation_events(approved_by);
create index if not exists hr_compensation_events_created_by_fk400_idx on public.hr_compensation_events(created_by);
create index if not exists hr_bonuses_project_fk400_idx on public.hr_bonuses(project_id);
create index if not exists hr_bonuses_approved_by_fk400_idx on public.hr_bonuses(approved_by);
create index if not exists hr_surveys_created_by_fk400_idx on public.hr_surveys(created_by);
create index if not exists hr_survey_responses_employee_fk400_idx on public.hr_survey_responses(employee_id);

create index if not exists hr_succession_created_by_fk400_idx on public.hr_succession_candidates(created_by);
create index if not exists hr_employee_requests_reviewed_by_fk400_idx on public.hr_employee_requests(reviewed_by);
create index if not exists hr_rcp_connections_created_by_fk400_idx on public.hr_rcp_connections(created_by);
create index if not exists hr_rcp_events_connection_fk400_idx on public.hr_rcp_events(connection_id);
create index if not exists hr_rcp_events_employee_fk400_idx on public.hr_rcp_events(employee_id);

create index if not exists hr_ai_recommendations_employee_fk400_idx on public.hr_ai_recommendations(employee_id);
create index if not exists hr_ai_recommendations_project_fk400_idx on public.hr_ai_recommendations(project_id);
create index if not exists hr_ai_recommendations_resolved_by_fk400_idx on public.hr_ai_recommendations(resolved_by);

-- Summary jest czytany przez service client. SECURITY DEFINER nie jest dostępny bezpośrednio klientowi.
revoke all on function public.get_hr_market_summary_400(uuid,date) from public,anon,authenticated;
grant execute on function public.get_hr_market_summary_400(uuid,date) to service_role;

insert into public.app_schema_versions(version)
values('20260903_hr_market_400_hardening')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
