import "server-only";

import { getHrWorkspace141Data } from "@/lib/data/hr-workspace-141";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Options = { query?: string; referenceDate?: string; includePayroll?: boolean };

function rows(result: Result, label: string) {
  if (result.error) throw new Error(`Nie udało się pobrać ${label} Kadr 4.0: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

export async function getHrMarket400Data(workspaceId: string, options: Options = {}) {
  const base = await getHrWorkspace141Data(workspaceId, options);
  const db = createServiceSupabaseClient();
  const referenceDate = options.referenceDate ?? base.referenceDate;
  const [summary, requisitions, candidates, candidateEvents, lifecycleTasks, trips, tripExpenses, competencies, employeeCompetencies,
    trainingPlans, performanceCycles, goals, reviews, demands, readiness, crew, compensation, bonuses, surveys, surveyResponses,
    careerPaths, succession, employeeRequests, rcpConnections, rcpMappings, rcpEvents, aiRecommendations] = await Promise.all([
    db.rpc("get_hr_market_summary_400", { p_workspace_id: workspaceId, p_reference_date: referenceDate }),
    db.from("hr_job_requisitions").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(1000),
    db.from("hr_candidates").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(3000),
    db.from("hr_candidate_events").select("*").eq("workspace_id", workspaceId).order("event_at", { ascending: false }).limit(5000),
    db.from("hr_lifecycle_tasks").select("*").eq("workspace_id", workspaceId).order("due_date").limit(5000),
    db.from("hr_business_trips").select("*").eq("workspace_id", workspaceId).order("date_from", { ascending: false }).limit(3000),
    db.from("hr_business_trip_expenses").select("*").eq("workspace_id", workspaceId).order("expense_date", { ascending: false }).limit(5000),
    db.from("hr_competency_catalog").select("*").eq("workspace_id", workspaceId).order("category").order("name").limit(2000),
    db.from("hr_employee_competencies").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(8000),
    db.from("hr_training_plans").select("*").eq("workspace_id", workspaceId).order("due_date").limit(5000),
    db.from("hr_performance_cycles").select("*").eq("workspace_id", workspaceId).order("date_from", { ascending: false }).limit(500),
    db.from("hr_goals").select("*").eq("workspace_id", workspaceId).order("due_date").limit(5000),
    db.from("hr_performance_reviews").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(5000),
    db.from("hr_workforce_demands").select("*").eq("workspace_id", workspaceId).order("date_from").limit(3000),
    db.from("hr_readiness_snapshots").select("*").eq("workspace_id", workspaceId).eq("reference_date", referenceDate).order("calculated_at", { ascending: false }).limit(5000),
    db.from("hr_crew_suggestions").select("*").eq("workspace_id", workspaceId).order("overall_score", { ascending: false }).limit(8000),
    options.includePayroll ? db.from("hr_compensation_events").select("*").eq("workspace_id", workspaceId).order("effective_from", { ascending: false }).limit(5000) : Promise.resolve({ data: [], error: null }),
    options.includePayroll ? db.from("hr_bonuses").select("*").eq("workspace_id", workspaceId).order("period_month", { ascending: false }).limit(5000) : Promise.resolve({ data: [], error: null }),
    db.from("hr_surveys").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1000),
    db.from("hr_survey_responses").select("*").eq("workspace_id", workspaceId).order("submitted_at", { ascending: false }).limit(8000),
    db.from("hr_career_paths").select("*").eq("workspace_id", workspaceId).order("name").limit(1000),
    db.from("hr_succession_candidates").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(3000),
    db.from("hr_employee_requests").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5000),
    db.from("hr_rcp_connections").select("id,provider,name,mode,status,base_url,capabilities,config,last_sync_at,last_error,created_at,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(100),
    db.from("hr_rcp_employee_mappings").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5000),
    db.from("hr_rcp_events").select("id,connection_id,employee_id,external_event_id,event_type,occurred_at,device_id,location,source,processed,created_at").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(8000),
    db.from("hr_ai_recommendations").select("*").eq("workspace_id", workspaceId).in("status", ["new", "accepted", "executed"]).order("updated_at", { ascending: false }).limit(1500)
  ]);
  if (summary.error) throw new Error(`Nie udało się pobrać KPI Kadr 4.0: ${summary.error.message}`);

  return {
    ...base,
    hr400Summary: (summary.data && typeof summary.data === "object" ? summary.data : {}) as Row,
    jobRequisitions: rows(requisitions, "rekrutacji"), candidates: rows(candidates, "kandydatów"), candidateEvents: rows(candidateEvents, "zdarzeń rekrutacji"),
    lifecycleTasks: rows(lifecycleTasks, "onboardingu/offboardingu"), businessTrips: rows(trips, "delegacji"), businessTripExpenses: rows(tripExpenses, "kosztów delegacji"),
    competencyCatalog: rows(competencies, "katalogu kompetencji"), employeeCompetencies: rows(employeeCompetencies, "kompetencji pracowników"), trainingPlans: rows(trainingPlans, "planów szkoleń"),
    performanceCycles: rows(performanceCycles, "cykli ocen"), goals: rows(goals, "celów"), performanceReviews: rows(reviews, "ocen okresowych"),
    workforceDemands: rows(demands, "zapotrzebowania na zasoby"), readinessSnapshots: rows(readiness, "People Readiness"), crewSuggestions: rows(crew, "AI Crew Builder"),
    compensationEvents: rows(compensation, "historii wynagrodzeń"), bonuses: rows(bonuses, "premii"), surveys: rows(surveys, "ankiet"), surveyResponses: rows(surveyResponses, "odpowiedzi ankiet"),
    careerPaths: rows(careerPaths, "ścieżek kariery"), successionCandidates: rows(succession, "sukcesji"), employeeRequests: rows(employeeRequests, "wniosków pracowniczych"),
    rcpConnections: rows(rcpConnections, "integracji RCP"), rcpMappings: rows(rcpMappings, "mapowań RCP"), rcpEvents: rows(rcpEvents, "zdarzeń RCP"),
    hrAiRecommendations: rows(aiRecommendations, "rekomendacji AI HR Controller")
  };
}
