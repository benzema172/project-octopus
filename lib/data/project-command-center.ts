import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

type HealthDeduction = { code: string; label: string; points: number; count: number };

function buildHealth(snapshot: Record<string, unknown>) {
  const anomalies = record(snapshot.anomalies);
  const schedule = record(snapshot.schedule);
  const quality = record(snapshot.quality);
  const critical = Number(anomalies.critical ?? 0);
  const open = Number(anomalies.open ?? 0);
  const overdueCritical = Number(schedule.overdueCritical ?? 0);
  const missingEvidence = Number(quality.missingEvidence ?? 0);
  const actualCost = Number(snapshot.actualCost ?? 0);
  const contractValue = Number(snapshot.contractValue ?? 0);
  const forecast = record(snapshot.forecast);
  const margin = forecast.margin == null ? null : Number(forecast.margin);
  const financeCoverage = record(snapshot.financeCoverage);
  const allocationCoveragePct = Math.max(0, Math.min(100, Number(financeCoverage.allocationCoveragePct ?? 100)));

  const deductions: HealthDeduction[] = [];
  const add = (code: string, label: string, points: number, count: number) => {
    const rounded = Math.max(0, Math.round(points));
    if (rounded > 0) deductions.push({ code, label, points: rounded, count });
  };
  add("critical_anomalies", "Krytyczne anomalie", critical * 18, critical);
  add("open_anomalies", "Pozostałe aktywne anomalie", Math.max(0, open - critical) * 4, Math.max(0, open - critical));
  add("critical_schedule", "Opóźnione zadania krytyczne", overdueCritical * 10, overdueCritical);
  add("missing_evidence", "Brakujące dowody / protokoły", Math.min(20, missingEvidence * 2), missingEvidence);
  if (margin != null && margin < 0) add("negative_margin", "Ujemna prognozowana marża", 20, 1);
  if (contractValue > 0 && actualCost > contractValue) add("cost_over_contract", "Koszt przypisany przekracza kontrakt", 15, 1);

  const totalDeductions = deductions.reduce((sum, item) => sum + item.points, 0);
  const score = Math.max(0, Math.min(100, 100 - totalDeductions));
  const status = score >= 85 ? "healthy" : score >= 65 ? "watch" : score >= 40 ? "risk" : "critical";
  const nextAction = critical > 0
    ? "Rozwiąż krytyczne anomalie przed kolejnymi zatwierdzeniami."
    : overdueCritical > 0
      ? "Zaktualizuj opóźnione zadania krytyczne i prognozę terminu."
      : margin != null && margin < 0
        ? "Przejrzyj koszty, zobowiązania i zmiany kontraktowe — forecast pokazuje stratę."
        : missingEvidence > 0
          ? "Uzupełnij brakujące dowody odbiorowe i protokoły."
          : open > 0
            ? "Przejrzyj aktywne odchylenia w Anomaly Engine."
            : allocationCoveragePct < 80
              ? "Uzupełnij przypisanie faktur do inwestycji, aby zwiększyć wiarygodność danych finansowych."
              : "Brak krytycznej blokady — kontynuuj realizację zgodnie z harmonogramem.";

  return {
    score,
    status,
    nextAction,
    critical,
    open,
    overdueCritical,
    missingEvidence,
    deductions,
    totalDeductions,
    dataConfidence: {
      allocationCoveragePct,
      status: allocationCoveragePct >= 95 ? "high" : allocationCoveragePct >= 80 ? "medium" : "low"
    }
  };
}

export async function getProjectCommandCenter(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const { data: anomaliesRefreshed, error: anomalyRefreshError } = await db.rpc("refresh_project_anomalies_if_stale", {
    p_workspace_id: workspaceId,
    p_project_id: projectId,
    p_min_interval_seconds: 300
  });
  if (anomalyRefreshError) throw new Error(`Nie udało się odświeżyć Anomaly Engine: ${anomalyRefreshError.message}`);

  const [centerResult, anomaliesResult, correspondenceResult, resourceResult, employeesResult] = await Promise.all([
    db.rpc("get_project_command_center", { p_workspace_id: workspaceId, p_project_id: projectId }),
    db.from("project_anomalies").select("id,category,severity,title,detail,entity_type,entity_id,status,detected_at,first_detected_at,last_seen_at").eq("workspace_id", workspaceId).eq("project_id", projectId).order("status").order("last_seen_at", { ascending: false }).limit(50),
    db.from("project_correspondence").select("id,direction,correspondence_type,subject,counterparty,reference_number,sent_at,due_at,status,notes").eq("workspace_id", workspaceId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(50),
    db.from("resource_plan_entries").select("id,employee_id,role,week_start,planned_hours,allocation_percent,status,note").eq("workspace_id", workspaceId).eq("project_id", projectId).order("week_start").limit(100),
    db.from("employees").select("id,first_name,last_name,status").eq("workspace_id", workspaceId).eq("status", "active").order("last_name").limit(500)
  ]);
  if (centerResult.error) throw new Error(`Command Center nie może obliczyć stanu inwestycji: ${centerResult.error.message}`);
  if (anomaliesResult.error) throw new Error(`Nie udało się odczytać anomalii: ${anomaliesResult.error.message}`);
  if (correspondenceResult.error) throw new Error(`Nie udało się odczytać korespondencji: ${correspondenceResult.error.message}`);
  if (resourceResult.error) throw new Error(`Nie udało się odczytać planu zasobów: ${resourceResult.error.message}`);
  if (employeesResult.error) throw new Error(`Nie udało się odczytać pracowników: ${employeesResult.error.message}`);

  const snapshot = (centerResult.data ?? {}) as Record<string, unknown>;
  const health = buildHealth(snapshot);
  snapshot.projectHealth = health;
  snapshot.nextAction = health.nextAction;

  // Persist history only when the runtime state was actually refreshed. Ordinary reads stay read-mostly.
  if (anomaliesRefreshed === true) {
    const { error: healthError } = await db.from("project_health_snapshots").upsert({
      workspace_id: workspaceId,
      project_id: projectId,
      snapshot_date: new Date().toISOString().slice(0, 10),
      score: health.score,
      status: health.status,
      payload: { ...snapshot, projectHealth: health }
    }, { onConflict: "project_id,snapshot_date" });
    if (healthError) console.error("Project Octopus: Project Health snapshot failed", healthError.message);
  }

  return {
    snapshot,
    anomalies: anomaliesResult.data ?? [],
    correspondence: correspondenceResult.data ?? [],
    resources: resourceResult.data ?? [],
    employees: employeesResult.data ?? []
  };
}
