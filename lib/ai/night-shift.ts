import "server-only";

import { geminiGenerate, loadAiWorkspacePolicy } from "@/lib/ai/control-plane";
import { indexWorkspaceBrain } from "@/lib/ai/brain-retrieval";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

function outputText(payload: Record<string, unknown>) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidate = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined;
  return candidate?.content?.parts?.map((part) => part.text ?? "").join("\n").trim() ?? "";
}

export async function runOctopusNightShift(input: { workspaceId: string; referenceDate?: string }) {
  const db = createServiceSupabaseClient();
  const policy = await loadAiWorkspacePolicy(input.workspaceId);
  const referenceDate = input.referenceDate ?? new Date().toISOString().slice(0, 10);
  if (!policy.nightShiftEnabled) return { skipped: true, reason: "night_shift_disabled" };

  await db.from("ai_briefings").upsert({
    workspace_id: input.workspaceId,
    briefing_date: referenceDate,
    status: "running",
    started_at: new Date().toISOString(),
    completed_at: null
  }, { onConflict: "workspace_id,briefing_date" });

  const brainIndex = await indexWorkspaceBrain({ workspaceId: input.workspaceId, limit: 40 }).catch((error) => ({ indexed: 0, failed: 1, error: error instanceof Error ? error.message : String(error) }));
  const dayStart = `${referenceDate}T00:00:00.000Z`;

  const [
    projectsResult, tasksResult, warehouseReviewsResult, warehouseRecommendationsResult,
    hrRecommendationsResult, fleetRecommendationsResult, fleetPredictionsResult,
    approvalsResult, actionsResult, allocationsResult
  ] = await Promise.all([
    db.from("projects").select("id,name,status,contract_value,currency,contract_end").eq("workspace_id", input.workspaceId).neq("status", "archived").limit(200),
    db.from("tasks").select("id,project_id,title,status,priority,due_at").eq("workspace_id", input.workspaceId).neq("status", "done").limit(500),
    db.from("warehouse_document_reviews").select("id,project_id,document_number,supplier_name,status,review_lines,created_at").eq("workspace_id", input.workspaceId).in("status", ["waiting","in_review"]).limit(500),
    db.from("warehouse_ai_recommendations").select("id,project_id,recommendation_type,title,description,severity,status").eq("workspace_id", input.workspaceId).eq("status", "new").limit(300),
    db.from("hr_ai_recommendations").select("id,project_id,recommendation_type,title,description,severity,status").eq("workspace_id", input.workspaceId).eq("status", "new").limit(300),
    db.from("fleet_ai_recommendations").select("id,project_id,recommendation_type,title,description,severity,status").eq("workspace_id", input.workspaceId).eq("status", "new").limit(300),
    db.from("fleet_maintenance_predictions").select("id,vehicle_id,prediction_type,risk_probability,predicted_date,status,evidence").eq("workspace_id", input.workspaceId).in("status", ["new","open"]).limit(300),
    db.from("approvals").select("id,project_id,entity_type,approval_type,status,due_at").eq("workspace_id", input.workspaceId).eq("status", "pending").limit(300),
    db.from("ai_action_log").select("id,status,tool_name,risk_level").eq("workspace_id", input.workspaceId).gte("created_at", dayStart).limit(1000),
    db.from("financial_allocations").select("project_id,amount,status").eq("workspace_id", input.workspaceId).limit(5000)
  ]);

  const projects = projectsResult.data ?? [];
  const tasks = tasksResult.data ?? [];
  const waitingWarehouse = warehouseReviewsResult.data ?? [];
  const approvals = approvalsResult.data ?? [];
  const actions = actionsResult.data ?? [];
  const allocations = allocationsResult.data ?? [];
  const recommendations = [
    ...(warehouseRecommendationsResult.data ?? []).map((row) => ({ module: "warehouse", ...row })),
    ...(hrRecommendationsResult.data ?? []).map((row) => ({ module: "hr", ...row })),
    ...(fleetRecommendationsResult.data ?? []).map((row) => ({ module: "fleet", ...row }))
  ];
  const fleetPredictions = fleetPredictionsResult.data ?? [];

  const today = new Date(referenceDate + "T12:00:00Z");
  const overdueTasks = tasks.filter((task) => task.due_at && new Date(String(task.due_at)) < today);
  const financialSignals = projects.map((project) => {
    const allocated = allocations.filter((row) => row.project_id === project.id).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const contract = Number(project.contract_value ?? 0);
    return { projectId: project.id, name: project.name, contractValue: contract, allocatedCost: allocated, allocationRatio: contract > 0 ? allocated / contract : null };
  }).filter((row) => row.allocationRatio != null && row.allocationRatio > 0.85);
  const criticalRecommendations = recommendations.filter((row) => ["critical","warning"].includes(String(row.severity)));
  const highRiskFleet = fleetPredictions.filter((row) => Number(row.risk_probability ?? 0) >= 0.7);

  const decisionsRequired = waitingWarehouse.length + approvals.length;
  const autonomousActions = actions.filter((row) => row.status === "executed").length;
  const risksFound = overdueTasks.length + criticalRecommendations.length + highRiskFleet.length + financialSignals.length;
  const signalPayload = {
    referenceDate,
    projects: projects.length,
    overdueTasks: overdueTasks.slice(0, 40),
    waitingWarehouse: waitingWarehouse.slice(0, 40),
    pendingApprovals: approvals.slice(0, 40),
    recommendations: criticalRecommendations.slice(0, 60),
    fleetRisks: highRiskFleet.slice(0, 40),
    financialSignals: financialSignals.slice(0, 40),
    autonomousActions,
    brainIndex
  };

  let summary = `Octopus Night Shift: ${decisionsRequired} decyzji, ${risksFound} sygnałów ryzyka, ${autonomousActions} wykonanych bezpiecznych działań.`;
  let modelName: string | null = null;
  try {
    const response = await geminiGenerate({
      task: "cross_module",
      system: "Jesteś nocnym kontrolerem operacyjnym Project Octopus. Otrzymujesz wyłącznie zweryfikowane sygnały z modułów. Napisz po polsku krótki poranny briefing: najpierw decyzje wymagające człowieka, potem ryzyka, potem działania automatyczne. Nie wymyślaj faktów ani kwot. Maksymalnie 12 punktów.",
      contents: [{ role: "user", parts: [{ text: JSON.stringify(signalPayload) }] }],
      maxOutputTokens: 1800,
      temperature: 0.05,
      timeoutMs: 65_000
    });
    summary = outputText(response.payload) || summary;
    modelName = response.model;
  } catch {
    // Deterministic briefing above is still useful and keeps Night Shift independent of provider availability.
  }

  const status = brainIndex.failed > 0 ? "partial" : "ready";
  const { error: briefingError } = await db.from("ai_briefings").upsert({
    workspace_id: input.workspaceId,
    briefing_date: referenceDate,
    status,
    summary,
    decisions_required: decisionsRequired,
    autonomous_actions: autonomousActions,
    risks_found: risksFound,
    payload: signalPayload,
    model_name: modelName,
    completed_at: new Date().toISOString()
  }, { onConflict: "workspace_id,briefing_date" });
  if (briefingError) throw new Error(`Nie udało się zapisać briefingu Night Shift: ${briefingError.message}`);

  await db.from("ai_quality_events").insert({
    workspace_id: input.workspaceId,
    entity_type: "night_shift",
    entity_id: referenceDate,
    event_type: "night_shift",
    model_name: modelName,
    prompt_version: "octopus-ai-2-night-shift-v1",
    schema_version: "ai20",
    warnings_count: risksFound,
    facts_count: projects.length + tasks.length + waitingWarehouse.length,
    decision: status,
    corrected: false,
    payload: { decisionsRequired, autonomousActions, risksFound, brainIndex }
  }).then(() => undefined);

  return { skipped: false, status, summary, decisionsRequired, autonomousActions, risksFound, brainIndex, model: modelName };
}
