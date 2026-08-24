import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type AiInboxItem = {
  id: string;
  entityType: "document" | "estimate_import" | "change_impact" | "site_event" | "template_version" | "knowledge_entry";
  projectId: string | null;
  title: string;
  subtitle: string;
  status: "new" | "processing" | "review" | "error" | "ready" | "rejected";
  confidence: number | null;
  category: string;
  createdAt: string;
  detail: string;
  proposedProjectId?: string | null;
  proposedProjectName?: string | null;
  requestedCategory?: string | null;
  categoryLocked?: boolean;
  matchStatus?: string | null;
  matchReason?: string | null;
  channel?: string;
  priority?: "low" | "normal" | "high" | "critical";
  assignedTo?: string | null;
  reviewDueAt?: string | null;
  escalationLevel?: number;
  overdue?: boolean;
  canWrite?: boolean;
  canApprove?: boolean;
};

export type AiInboxProjectOption = { id: string; name: string };

export type ProjectMatchQuality = {
  reviewed: number;
  confirmed: number;
  corrected: number;
  rejected: number;
  aliases: number;
  precision: number | null;
  recall: number | null;
  correctionRate: number | null;
};

type IntakeRow = {
  id: string;
  document_id: string;
  proposed_project_id: string | null;
  status: string;
  suggested_category: string | null;
  requested_category: string | null;
  category_locked: boolean;
  match_metadata: Record<string, unknown> | null;
  confidence: number | null;
  channel: string;
  priority: "low" | "normal" | "high" | "critical";
  assigned_to: string | null;
  review_due_at: string | null;
  escalation_level: number;
  created_at: string;
  documents: { name?: string; ai_status?: string; project_id?: string | null } | Array<{ name?: string; ai_status?: string; project_id?: string | null }> | null;
};

function normalizedStatus(status: string, aiStatus?: string): AiInboxItem["status"] {
  const value = aiStatus === "error" ? "error" : status;
  if (["queued", "pending", "new"].includes(value)) return "new";
  if (["running", "processing", "extract", "analyze"].includes(value)) return "processing";
  if (["review", "proposed", "mapping"].includes(value)) return "review";
  if (["error", "failed", "dead_letter"].includes(value)) return "error";
  if (["ready", "approved", "succeeded", "complete"].includes(value)) return "ready";
  if (value === "rejected") return "rejected";
  return "new";
}

export async function listAiInbox(workspaceId: string): Promise<AiInboxItem[]> {
  const supabase = createServiceSupabaseClient();
  const [intakesResult, estimatesResult, impactsResult, siteEventsResult, templatesResult, knowledgeResult] = await Promise.all([
    supabase
      .from("document_intakes")
      .select("id,document_id,proposed_project_id,status,suggested_category,requested_category,category_locked,match_metadata,confidence,channel,priority,assigned_to,review_due_at,escalation_level,created_at,documents(name,ai_status,project_id)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<IntakeRow[]>(),
    supabase
      .from("estimate_imports")
      .select("id,project_id,status,detected_rows,accepted_rows,warnings,created_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["mapping", "review", "error"])
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("document_change_impacts")
      .select("id,project_id,status,impact_type,target_type,summary,risk_level,created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("site_events")
      .select("id,project_id,status,event_type,title,description,created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("template_versions")
      .select("id,status,version_number,created_at,templates!inner(name,template_type,workspace_id)")
      .eq("templates.workspace_id", workspaceId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("knowledge_entries")
      .select("id,source_project_id,entry_type,title,summary,status,created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(30)
  ]);

  const proposedProjectIds = Array.from(new Set((intakesResult.data ?? []).map((row) => row.proposed_project_id).filter((value): value is string => Boolean(value))));
  const { data: proposedProjects } = proposedProjectIds.length
    ? await supabase.from("projects").select("id,name").in("id", proposedProjectIds).returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }> };
  const proposedProjectNames = new Map((proposedProjects ?? []).map((project) => [project.id, project.name]));

  const items: AiInboxItem[] = (intakesResult.data ?? []).map((row) => {
    const document = Array.isArray(row.documents) ? row.documents[0] : row.documents;
    const match = row.match_metadata && typeof row.match_metadata.project_match === "object" && row.match_metadata.project_match
      ? row.match_metadata.project_match as Record<string, unknown>
      : null;
    const matchReason = typeof match?.reason === "string" ? match.reason : null;
    return {
      id: row.document_id,
      entityType: "document",
      projectId: document?.project_id ?? row.proposed_project_id,
      title: document?.name ?? "Dokument bez nazwy",
      subtitle: "Klasyfikacja i Project DNA",
      status: normalizedStatus(row.status, document?.ai_status),
      confidence: row.confidence,
      category: row.suggested_category ?? "nierozpoznana",
      createdAt: row.created_at,
      detail: row.status === "review"
        ? matchReason ?? "Sprawdź kategorię, inwestycję i fakty przed zatwierdzeniem."
        : "Dokument przechodzi wspólny pipeline AI.",
      proposedProjectId: row.proposed_project_id,
      proposedProjectName: row.proposed_project_id ? proposedProjectNames.get(row.proposed_project_id) ?? null : null,
      requestedCategory: row.requested_category,
      categoryLocked: row.category_locked,
      matchStatus: typeof match?.status === "string" ? match.status : null,
      matchReason,
      channel: row.channel,
      priority: row.priority,
      assignedTo: row.assigned_to,
      reviewDueAt: row.review_due_at,
      escalationLevel: row.escalation_level,
      overdue: row.status === "review" && Boolean(row.review_due_at) && Date.parse(row.review_due_at ?? "") < Date.now()
    };
  });

  for (const row of estimatesResult.data ?? []) {
    items.push({
      id: String(row.id), entityType: "estimate_import", projectId: row.project_id ? String(row.project_id) : null,
      title: `Import kosztorysu — ${row.detected_rows ?? 0} pozycji`, subtitle: "BOQ / WBS", status: normalizedStatus(String(row.status)),
      confidence: null, category: "estimate", createdAt: String(row.created_at),
      detail: `${row.accepted_rows ?? 0} zaakceptowanych. Zatwierdzenie utworzy wersję BOQ, WBS i szkic harmonogramu.`
    });
  }
  for (const row of impactsResult.data ?? []) {
    items.push({
      id: String(row.id), entityType: "change_impact", projectId: row.project_id ? String(row.project_id) : null,
      title: String(row.summary), subtitle: `Radar zmiany · ${row.target_type}`, status: "review", confidence: null,
      category: String(row.impact_type), createdAt: String(row.created_at), detail: `Ryzyko: ${row.risk_level}. Zmiana nie aktualizuje danych bez decyzji.`
    });
  }
  for (const row of siteEventsResult.data ?? []) {
    items.push({
      id: String(row.id), entityType: "site_event", projectId: row.project_id ? String(row.project_id) : null,
      title: String(row.title), subtitle: "Zdarzenie z budowy", status: "review", confidence: null,
      category: String(row.event_type), createdAt: String(row.created_at), detail: String(row.description ?? "Wymaga zatwierdzenia kierownika.")
    });
  }
  for (const row of templatesResult.data ?? []) {
    const templateValue = row.templates as unknown;
    const template = Array.isArray(templateValue) ? templateValue[0] as Record<string, unknown> : templateValue as Record<string, unknown> | null;
    items.push({
      id: String(row.id), entityType: "template_version", projectId: null,
      title: String(template?.name ?? "Wzór bez nazwy"), subtitle: `Wzór v${row.version_number}`, status: "review", confidence: null,
      category: String(template?.template_type ?? "document"), createdAt: String(row.created_at), detail: "Sprawdź pola, źródła danych i wynik testowy przed dopuszczeniem wzoru do generatora."
    });
  }
  for (const row of knowledgeResult.data ?? []) {
    items.push({
      id: String(row.id), entityType: "knowledge_entry", projectId: row.source_project_id ? String(row.source_project_id) : null,
      title: String(row.title), subtitle: "Pamięć organizacji", status: "review", confidence: null,
      category: String(row.entry_type), createdAt: String(row.created_at), detail: String(row.summary)
    });
  }

  const priorityRank = { critical: 4, high: 3, normal: 2, low: 1 } as const;
  return items.sort((left, right) => {
    if (Boolean(left.overdue) !== Boolean(right.overdue)) return left.overdue ? -1 : 1;
    const priorityDifference = priorityRank[right.priority ?? "normal"] - priorityRank[left.priority ?? "normal"];
    return priorityDifference || Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export async function getProjectMatchQuality(workspaceId: string, visibleProjectIds: string[] = []): Promise<ProjectMatchQuality> {
  const db = createServiceSupabaseClient();
  let aliasQuery = db.from("project_match_aliases").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("active", true);
  if (visibleProjectIds.length) aliasQuery = aliasQuery.in("project_id", visibleProjectIds);
  const [feedbackResult, aliasesResult] = await Promise.all([
    db.from("project_match_feedback")
      .select("outcome,proposed_project_id,selected_project_id")
      .eq("workspace_id", workspaceId).order("decided_at", { ascending: false }).limit(5000),
    aliasQuery
  ]);
  if (feedbackResult.error) throw new Error(`Nie udało się policzyć jakości matchera: ${feedbackResult.error.message}`);
  if (aliasesResult.error) throw new Error(`Nie udało się policzyć aliasów matchera: ${aliasesResult.error.message}`);
  const visible = new Set(visibleProjectIds);
  const feedback = (feedbackResult.data ?? []).filter((row) => !visible.size
    || (row.selected_project_id && visible.has(String(row.selected_project_id)))
    || (row.proposed_project_id && visible.has(String(row.proposed_project_id))));
  const confirmed = feedback.filter((row) => row.outcome === "confirmed").length;
  const corrected = feedback.filter((row) => row.outcome === "corrected").length;
  const rejected = feedback.filter((row) => row.outcome === "rejected").length;
  const truePositive = feedback.filter((row) => row.outcome === "confirmed" && row.proposed_project_id && row.proposed_project_id === row.selected_project_id).length;
  const falsePositive = feedback.filter((row) => row.proposed_project_id && (row.outcome === "corrected" || row.outcome === "rejected")).length;
  const falseNegative = feedback.filter((row) => !row.proposed_project_id && Boolean(row.selected_project_id)).length;
  const precisionDenominator = truePositive + falsePositive;
  const recallDenominator = truePositive + falseNegative;
  return {
    reviewed: feedback.length,
    confirmed,
    corrected,
    rejected,
    aliases: aliasesResult.count ?? 0,
    precision: precisionDenominator ? truePositive / precisionDenominator : null,
    recall: recallDenominator ? truePositive / recallDenominator : null,
    correctionRate: feedback.length ? corrected / feedback.length : null
  };
}

export type ProjectExecutionSnapshot = {
  schemaReady: boolean;
  boqItems: number;
  wbsNodes: number;
  requirements: number;
  protocolsRequired: number;
  protocolsClosed: number;
  scheduleActivities: number;
  progressEntries: number;
  evidenceRequired: number;
  evidenceComplete: number;
  changeImpacts: number;
  materialEvents: number;
  siteEvents: number;
  closeoutRequired: number;
  closeoutComplete: number;
  latestForecast: null | {
    forecast_finish_date: string | null;
    estimate_at_completion: number;
    forecast_margin: number | null;
  };
};

export async function isExecutionLayerSchemaReady() {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("app_schema_versions")
    .select("version")
    .eq("version", "20260814_domain_access_hardening")
    .maybeSingle<{ version: string }>();

  return !error && data?.version === "20260814_domain_access_hardening";
}

export async function getProjectExecutionSnapshot(
  workspaceId: string,
  projectId: string,
  options: { includeFinance?: boolean; includeWarehouse?: boolean } = {}
): Promise<ProjectExecutionSnapshot> {
  if (!await isExecutionLayerSchemaReady()) {
    return {
      schemaReady: false,
      boqItems: 0, wbsNodes: 0, requirements: 0, protocolsRequired: 0, protocolsClosed: 0,
      scheduleActivities: 0, progressEntries: 0, evidenceRequired: 0, evidenceComplete: 0,
      changeImpacts: 0, materialEvents: 0, siteEvents: 0, closeoutRequired: 0, closeoutComplete: 0,
      latestForecast: null
    };
  }
  const supabase = createServiceSupabaseClient();
  const count = (table: string, status?: string | string[]) => {
    let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("project_id", projectId);
    if (Array.isArray(status) && status.length) query = query.in("status", status);
    else if (typeof status === "string") query = query.eq("status", status);
    return query;
  };
  const [boq, wbs, requirements, protocolRequired, protocolClosed, schedule, progress, evidenceRequired, evidenceComplete, impacts, materials, site, closeoutRequired, closeoutComplete, forecast] = await Promise.all([
    count("boq_items"), count("wbs_nodes"), count("project_requirements"), count("protocol_requirements"),
    count("protocols", ["approved", "archived"]), count("schedule_activities"), count("progress_entries"),
    count("evidence_requirements"), count("evidence_requirements", "accepted"),
    count("document_change_impacts", "proposed"),
    options.includeWarehouse ? count("material_chain_events") : Promise.resolve({ count: null }),
    count("site_events"),
    count("closeout_requirements"), count("closeout_requirements", "complete"),
    options.includeFinance
      ? supabase.from("forecast_snapshots").select("forecast_finish_date,estimate_at_completion,forecast_margin").eq("workspace_id", workspaceId).eq("project_id", projectId).order("forecast_date", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null })
  ]);
  return {
    schemaReady: true,
    boqItems: boq.count ?? 0, wbsNodes: wbs.count ?? 0, requirements: requirements.count ?? 0,
    protocolsRequired: protocolRequired.count ?? 0, protocolsClosed: protocolClosed.count ?? 0,
    scheduleActivities: schedule.count ?? 0, progressEntries: progress.count ?? 0,
    evidenceRequired: evidenceRequired.count ?? 0, evidenceComplete: evidenceComplete.count ?? 0,
    changeImpacts: impacts.count ?? 0, materialEvents: materials.count ?? 0, siteEvents: site.count ?? 0,
    closeoutRequired: closeoutRequired.count ?? 0, closeoutComplete: closeoutComplete.count ?? 0,
    latestForecast: forecast.data ? {
      forecast_finish_date: forecast.data.forecast_finish_date ? String(forecast.data.forecast_finish_date) : null,
      estimate_at_completion: Number(forecast.data.estimate_at_completion ?? 0),
      forecast_margin: forecast.data.forecast_margin == null ? null : Number(forecast.data.forecast_margin)
    } : null
  };
}

export async function getBrainMetrics(workspaceId: string, projectId?: string) {
  const supabase = createServiceSupabaseClient();
  const documentCount = async (status: string) => {
    let query = supabase.from("documents").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("ai_status", status);
    if (projectId) query = query.eq("project_id", projectId);
    return (await query).count ?? 0;
  };
  const factQuery = supabase.from("project_facts").select("id,projects!inner(workspace_id)", { count: "exact", head: true }).eq("projects.workspace_id", workspaceId).eq("status", "approved");
  if (projectId) factQuery.eq("project_id", projectId);
  const wbsQuery = supabase.from("wbs_nodes").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (projectId) wbsQuery.eq("project_id", projectId);
  const [ready, review, error, facts, wbs] = await Promise.all([documentCount("ready"), documentCount("review"), documentCount("error"), factQuery, wbsQuery]);
  return { readyDocuments: ready, reviewDocuments: review, errorDocuments: error, approvedFacts: facts.count ?? 0, wbsNodes: wbs.count ?? 0 };
}
