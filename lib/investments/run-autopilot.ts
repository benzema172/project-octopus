import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type RequirementRow = { id: string; requirement_type: string; title: string; description: string | null; status: string; source_document_id: string | null };
type ProtocolRequirementRow = { id: string; protocol_type: string; title: string; status: string; required_evidence: unknown; trigger_rule: unknown };
type MaterialRequestRow = { id: string; title: string; status: string; payload: unknown; generated_source_key: string | null };
type ProtocolRow = { id: string; protocol_type: string; title: string; status: string; payload: unknown; generated_source_key: string | null };
type ScheduleRow = { id: string; title: string; status: string; constraint_note: string | null; generated_source_key: string | null };
type MaterialRow = { id: string; name: string; installation: string | null; specification: string | null };
type DeviceRow = { id: string; name: string; installation: string | null; parameters: unknown };

export type AutopilotRunSummary = {
  materialDrafts: number;
  protocolDrafts: number;
  scheduleDrafts: number;
  superseded: number;
  prepared: number;
  deduplicated?: number;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function sourceRequirementId(value: unknown) { const id = object(value).source_requirement_id; return typeof id === "string" ? id : null; }
function sourceKey(prefix: string, id: string) { return `${prefix}:${id}`; }

const STOP_WORDS = new Set(["i", "w", "z", "na", "do", "dla", "oraz", "the", "of", "a", "szt", "sztuka", "instalacja", "instalacji", "material", "materialu", "urzadzenie"]);
function tokens(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}
function candidateScore(query: string, candidate: string) {
  const q = tokens(query);
  const c = tokens(candidate);
  if (!q.size || !c.size) return 0;
  let shared = 0;
  for (const token of q) if (c.has(token)) shared += 1;
  const coverage = shared / q.size;
  const precision = shared / c.size;
  const normalizedQuery = normalize(query);
  const normalizedCandidate = normalize(candidate);
  const phraseBonus = normalizedQuery && normalizedCandidate.includes(normalizedQuery) ? 0.45 : normalizedCandidate && normalizedQuery.includes(normalizedCandidate) ? 0.25 : 0;
  return Math.min(1, coverage * 0.7 + precision * 0.3 + phraseBonus);
}

function rankedCandidates(requirement: RequirementRow, materials: MaterialRow[], devices: DeviceRow[]) {
  const query = `${requirement.title} ${requirement.description ?? ""}`;
  const materialCandidates = materials.map((item) => ({
    type: "material" as const,
    id: item.id,
    name: item.name,
    installation: item.installation,
    specification: item.specification,
    score: candidateScore(query, `${item.name} ${item.installation ?? ""} ${item.specification ?? ""}`)
  }));
  const deviceCandidates = devices.map((item) => ({
    type: "device" as const,
    id: item.id,
    name: item.name,
    installation: item.installation,
    parameters: item.parameters,
    score: candidateScore(query, `${item.name} ${item.installation ?? ""} ${JSON.stringify(item.parameters ?? {})}`)
  }));
  const ranked = [...materialCandidates, ...deviceCandidates].sort((left, right) => right.score - left.score);
  const meaningful = ranked.filter((item) => item.score >= 0.12).slice(0, 10);
  return meaningful.length > 0 ? meaningful : ranked.slice(0, 3);
}

async function insertGenerated(table: "material_requests" | "protocols" | "schedule_activities", row: Record<string, unknown>) {
  const result = await createServiceSupabaseClient().from(table).insert(row);
  if (!result.error) return true;
  if (result.error.code === "23505") return false;
  throw new Error(result.error.message);
}

export async function runInvestmentAutopilot(input: { workspaceId: string; projectId: string; userId: string }): Promise<AutopilotRunSummary> {
  const supabase = createServiceSupabaseClient();
  const [requirementsResult, protocolReqResult, requestsResult, protocolsResult, scheduleResult, materialsResult, devicesResult] = await Promise.all([
    supabase.from("project_requirements").select("id,requirement_type,title,description,status,source_document_id").eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).returns<RequirementRow[]>(),
    supabase.from("protocol_requirements").select("id,protocol_type,title,status,required_evidence,trigger_rule").eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).returns<ProtocolRequirementRow[]>(),
    supabase.from("material_requests").select("id,title,status,payload,generated_source_key").eq("project_id", input.projectId).returns<MaterialRequestRow[]>(),
    supabase.from("protocols").select("id,protocol_type,title,status,payload,generated_source_key").eq("project_id", input.projectId).returns<ProtocolRow[]>(),
    supabase.from("schedule_activities").select("id,title,status,constraint_note,generated_source_key").eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).returns<ScheduleRow[]>(),
    supabase.from("materials").select("id,name,installation,specification").eq("project_id", input.projectId).limit(500).returns<MaterialRow[]>(),
    supabase.from("devices").select("id,name,installation,parameters").eq("project_id", input.projectId).limit(500).returns<DeviceRow[]>()
  ]);
  const firstError = requirementsResult.error ?? protocolReqResult.error ?? requestsResult.error ?? protocolsResult.error ?? scheduleResult.error ?? materialsResult.error ?? devicesResult.error;
  if (firstError) throw new Error(`Autopilot nie może odczytać stanu inwestycji: ${firstError.message}`);

  const requirements = requirementsResult.data ?? [];
  const protocolRequirements = protocolReqResult.data ?? [];
  const existingRequests = requestsResult.data ?? [];
  const existingProtocols = protocolsResult.data ?? [];
  const existingSchedule = scheduleResult.data ?? [];
  const materials = materialsResult.data ?? [];
  const devices = devicesResult.data ?? [];

  const activeRequirementIds = new Set(requirements.filter((row) => !["rejected", "cancelled", "closed"].includes(normalize(row.status))).map((row) => row.id));
  const activeProtocolIds = new Set(protocolRequirements.filter((row) => !["rejected", "cancelled", "closed"].includes(normalize(row.status))).map((row) => row.id));
  const generatedRequestSources = new Set(existingRequests.map((row) => row.generated_source_key ?? (sourceRequirementId(row.payload) ? sourceKey("requirement", sourceRequirementId(row.payload)!) : null)).filter((id): id is string => Boolean(id)));
  const generatedProtocolSources = new Set(existingProtocols.map((row) => row.generated_source_key ?? (sourceRequirementId(row.payload) ? sourceKey("protocol-requirement", sourceRequirementId(row.payload)!) : null)).filter((id): id is string => Boolean(id)));
  const generatedScheduleSources = new Set(existingSchedule.map((row) => row.generated_source_key ?? (row.constraint_note?.match(/requirement:([0-9a-f-]{36})/i)?.[1] ? sourceKey("requirement", row.constraint_note.match(/requirement:([0-9a-f-]{36})/i)![1]) : null)).filter((id): id is string => Boolean(id)));

  const requestCandidates = requirements
    .filter((row) => ["material application", "material_application"].includes(normalize(row.requirement_type)))
    .filter((row) => !["approved", "accepted", "closed", "rejected"].includes(normalize(row.status)))
    .filter((row) => !generatedRequestSources.has(sourceKey("requirement", row.id)));

  const protocolCandidates = protocolRequirements
    .filter((row) => !["closed", "rejected", "cancelled"].includes(normalize(row.status)))
    .filter((row) => !generatedProtocolSources.has(sourceKey("protocol-requirement", row.id)))
    .filter((row) => !existingProtocols.some((protocol) => {
      const sameSource = sourceRequirementId(protocol.payload) === row.id;
      return sameSource && ["closed", "approved", "complete", "completed", "accepted"].includes(normalize(protocol.status));
    }));

  const scheduleCandidates = requirements
    .filter((row) => ["work stage", "work_stage"].includes(normalize(row.requirement_type)))
    .filter((row) => !["approved", "closed", "rejected"].includes(normalize(row.status)))
    .filter((row) => !generatedScheduleSources.has(sourceKey("requirement", row.id)));

  let materialDrafts = 0;
  let protocolDrafts = 0;
  let scheduleDrafts = 0;
  let deduplicated = 0;

  for (const row of requestCandidates) {
    const inserted = await insertGenerated("material_requests", {
      project_id: input.projectId,
      title: row.title.toLowerCase().startsWith("wniosek") ? row.title : `Szkic WM — ${row.title}`,
      status: "draft",
      generated_source_key: sourceKey("requirement", row.id),
      payload: {
        generated_by: "Octopus Autopilot",
        source_requirement_id: row.id,
        source_document_id: row.source_document_id,
        requirement_description: row.description,
        requires_human_approval: true,
        candidate_strategy: "semantic-token-rank-v1",
        candidates: rankedCandidates(row, materials, devices)
      },
      created_by: input.userId
    });
    if (inserted) materialDrafts += 1; else deduplicated += 1;
  }

  for (const row of protocolCandidates) {
    const inserted = await insertGenerated("protocols", {
      project_id: input.projectId,
      protocol_type: row.protocol_type,
      title: row.title,
      status: "draft",
      generated_source_key: sourceKey("protocol-requirement", row.id),
      payload: {
        generated_by: "Octopus Autopilot",
        source_requirement_id: row.id,
        trigger_rule: row.trigger_rule,
        required_evidence: row.required_evidence,
        result: null,
        performed_at: null,
        participants: [],
        warning: "Octopus przygotował szkic. Wynik pomiaru, faktyczne parametry próby i podpisy wymagają danych z budowy."
      },
      created_by: input.userId
    });
    if (inserted) protocolDrafts += 1; else deduplicated += 1;
  }

  for (const [index, row] of scheduleCandidates.entries()) {
    const inserted = await insertGenerated("schedule_activities", {
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      code: `AI-${String(index + 1).padStart(3, "0")}`,
      title: row.title,
      planned_start: null,
      planned_finish: null,
      critical: false,
      generated_source_key: sourceKey("requirement", row.id),
      constraint_note: `Octopus Autopilot · requirement:${row.id} · terminy wymagają zatwierdzenia baseline`,
      status: "planned"
    });
    if (inserted) scheduleDrafts += 1; else deduplicated += 1;
  }

  const supersededRequestIds = existingRequests.filter((row) => { const source = sourceRequirementId(row.payload); return source && !activeRequirementIds.has(source) && ["draft", "review", "proposed"].includes(normalize(row.status)); }).map((row) => row.id);
  const supersededProtocolIds = existingProtocols.filter((row) => { const source = sourceRequirementId(row.payload); return source && !activeProtocolIds.has(source) && ["draft", "review", "proposed"].includes(normalize(row.status)); }).map((row) => row.id);
  const supersededScheduleIds = existingSchedule.filter((row) => { const source = row.constraint_note?.match(/requirement:([0-9a-f-]{36})/i)?.[1]; return source && !activeRequirementIds.has(source) && ["planned", "draft"].includes(normalize(row.status)); }).map((row) => row.id);

  const writes: Array<PromiseLike<unknown>> = [];
  if (supersededRequestIds.length) writes.push(supabase.from("material_requests").update({ status: "superseded" }).in("id", supersededRequestIds).eq("project_id", input.projectId));
  if (supersededProtocolIds.length) writes.push(supabase.from("protocols").update({ status: "superseded" }).in("id", supersededProtocolIds).eq("project_id", input.projectId));
  if (supersededScheduleIds.length) writes.push(supabase.from("schedule_activities").update({ status: "superseded" }).in("id", supersededScheduleIds).eq("workspace_id", input.workspaceId).eq("project_id", input.projectId));
  const results = await Promise.all(writes);
  const writeError = results.map((result) => result as { error?: { message: string } | null }).find((result) => result.error)?.error;
  if (writeError) throw new Error(`Autopilot nie zapisał wszystkich zmian: ${writeError.message}`);

  const superseded = supersededRequestIds.length + supersededProtocolIds.length + supersededScheduleIds.length;
  const summary = { materialDrafts, protocolDrafts, scheduleDrafts, superseded, prepared: materialDrafts + protocolDrafts + scheduleDrafts, deduplicated };
  const { error: auditError } = await supabase.from("audit_events").insert({
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    actor_id: input.userId,
    actor_type: "ai",
    event_type: "investment.autopilot.run",
    entity_type: "project",
    entity_id: input.projectId,
    after_value: summary
  });
  if (auditError) console.error("Project Octopus: autopilot audit event failed", auditError.message);
  return summary;
}
