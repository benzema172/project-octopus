import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

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

  let score = 100;
  score -= critical * 18;
  score -= Math.max(0, open - critical) * 4;
  score -= overdueCritical * 10;
  score -= Math.min(20, missingEvidence * 2);
  if (margin != null && margin < 0) score -= 20;
  if (contractValue > 0 && actualCost > contractValue) score -= 15;
  score = Math.max(0, Math.min(100, Math.round(score)));

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
            ? "Przejrzyj otwarte odchylenia w Anomaly Engine."
            : "Brak krytycznej blokady — kontynuuj realizację zgodnie z harmonogramem.";

  return { score, status, nextAction, critical, open, overdueCritical, missingEvidence };
}

export async function getProjectCommandCenter(workspaceId: string, projectId: string) {
  const db = createServiceSupabaseClient();
  const { error: anomalyRefreshError } = await db.rpc("refresh_project_anomalies", { p_workspace_id: workspaceId, p_project_id: projectId });
  if (anomalyRefreshError) throw new Error(`Nie udało się odświeżyć Anomaly Engine: ${anomalyRefreshError.message}`);

  const [centerResult, anomaliesResult, correspondenceResult, resourceResult, employeesResult] = await Promise.all([
    db.rpc("get_project_command_center", { p_workspace_id: workspaceId, p_project_id: projectId }),
    db.from("project_anomalies").select("id,category,severity,title,detail,entity_type,entity_id,status,detected_at").eq("workspace_id", workspaceId).eq("project_id", projectId).order("status").order("detected_at", { ascending: false }).limit(50),
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

  const { error: healthError } = await db.from("project_health_snapshots").upsert({
    workspace_id: workspaceId,
    project_id: projectId,
    snapshot_date: new Date().toISOString().slice(0, 10),
    score: health.score,
    status: health.status,
    payload: { ...snapshot, projectHealth: health }
  }, { onConflict: "project_id,snapshot_date" });
  if (healthError) console.error("Project Octopus: Project Health snapshot failed", healthError.message);

  return {
    snapshot,
    anomalies: anomaliesResult.data ?? [],
    correspondence: correspondenceResult.data ?? [],
    resources: resourceResult.data ?? [],
    employees: employeesResult.data ?? []
  };
}
