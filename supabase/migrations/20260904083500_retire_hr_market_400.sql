begin;

-- Kadry 4.0 / HR Market 4.0 zostały wycofane z Project Octopus.
-- W chwili wycofania wszystkie poniższe tabele były puste na produkcji.
-- Zachowujemy Kadry Core 3.0 oraz historię starych migracji, a usuwamy tylko warstwę HR Market 4.0.

drop function if exists public.set_hr_rcp_secret_hash_400(uuid,uuid,text);
drop function if exists public.verify_hr_rcp_secret_400(uuid,text);
drop function if exists public.refresh_people_readiness_400(uuid,date);
drop function if exists public.build_hr_crew_400(uuid,uuid);
drop function if exists public.hr_daily_controller_400(uuid,date);
drop function if exists public.get_hr_market_summary_400(uuid,date);

drop table if exists private.hr_rcp_secrets;

drop table if exists public.hr_candidate_events;
drop table if exists public.hr_candidates;
drop table if exists public.hr_job_requisitions;

drop table if exists public.hr_business_trip_expenses;
drop table if exists public.hr_business_trips;

drop table if exists public.hr_training_plans;
drop table if exists public.hr_employee_competencies;
drop table if exists public.hr_competency_catalog;

drop table if exists public.hr_performance_reviews;
drop table if exists public.hr_goals;
drop table if exists public.hr_performance_cycles;

drop table if exists public.hr_crew_suggestions;
drop table if exists public.hr_workforce_demands;
drop table if exists public.hr_readiness_snapshots;

drop table if exists public.hr_compensation_events;
drop table if exists public.hr_bonuses;

drop table if exists public.hr_survey_responses;
drop table if exists public.hr_surveys;

drop table if exists public.hr_succession_candidates;
drop table if exists public.hr_career_paths;

drop table if exists public.hr_employee_requests;

drop table if exists public.hr_rcp_events;
drop table if exists public.hr_rcp_employee_mappings;
drop table if exists public.hr_rcp_connections;

drop table if exists public.hr_ai_recommendations;
drop table if exists public.hr_lifecycle_tasks;

insert into public.app_schema_versions(version)
values('20260904_hr_market_400_retired')
on conflict(version) do update set applied_at=excluded.applied_at;

commit;
