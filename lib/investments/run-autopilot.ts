import "server-only";

import { createServiceSupabaseClient } from "@/lib/supabase/service";

type RequirementRow = { id: string; requirement_type: string; title: string; description: string | null; status: string; source_document_id: string | null };
type ProtocolRequirementRow = { id: string; protocol_type: string; title: string; status: string; required_evidence: unknown; trigger_rule: unknown };
type MaterialRequestRow = { id: string; title: string; status: string; payload: unknown };
type ProtocolRow = { id: string; protocol_type: string; title: string; status: string; payload: unknown };
type ScheduleRow = { id: string; title: string; status: string; constraint_note: string | null };
type MaterialRow = { id: string; name: string; installation: string | null; specification: string | null };
type DeviceRow = { id: string; name: string; installation: string | null; parameters: unknown };

export type AutopilotRunSummary = { materialDrafts: number; protocolDrafts: number; scheduleDrafts: number; superseded: number; prepared: number };

function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function sourceRequirementId(value: unknown) { const id = object(value).source_requirement_id; return typeof id === "string" ? id : null; }

export async function runInvestmentAutopilot(input: { workspaceId: string; projectId: string; userId: string }): Promise<AutopilotRunSummary> {
  const supabase = createServiceSupabaseClient();
  const [requirementsResult, protocolReqResult, requestsResult, protocolsResult, scheduleResult, materialsResult, devicesResult] = await Promise.all([
    supabase.from("project_requirements").select("id,requirement_type,title,description,status,source_document_id").eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).returns<RequirementRow[]>(),
    supabase.from("protocol_requirements").select("id,protocol_type,title,status,required_evidence,trigger_rule").eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).returns<ProtocolRequirementRow[]>(),
    supabase.from("material_requests").select("id,title,status,payload").eq("project_id", input.projectId).returns<MaterialRequestRow[]>(),
    supabase.from("protocols").select("id,protocol_type,title,status,payload").eq("project_id", input.projectId).returns<ProtocolRow[]>(),
    supabase.from("schedule_activities").select("id,title,status,constraint_note").eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).returns<ScheduleRow[]>(),
    supabase.from("materials").select("id,name,installation,specification").eq("project_id", input.projectId).limit(200).returns<MaterialRow[]>(),
    supabase.from("devices").select("id,name,installation,parameters").eq("project_id", input.projectId).limit(200).returns<DeviceRow[]>()
  ]);
  const firstError = requirementsResult.error ?? protocolReqResult.error ?? requestsResult.error ?? protocolsResult.error ?? scheduleResult.error ?? materialsResult.error ?? devicesResult.error;
  if (firstError) throw new Error(`Autopilot nie może odczytać stanu inwestycji: ${firstError.message}`);

  const requirements = requirementsResult.data ?? [], protocolRequirements = protocolReqResult.data ?? [], existingRequests = requestsResult.data ?? [], existingProtocols = protocolsResult.data ?? [], existingSchedule = scheduleResult.data ?? [], materials = materialsResult.data ?? [], devices = devicesResult.data ?? [];
  const activeRequirementIds = new Set(requirements.filter((row) => !["rejected", "cancelled", "closed"].includes(normalize(row.status))).map((row) => row.id));
  const activeProtocolIds = new Set(protocolRequirements.filter((row) => !["rejected", "cancelled", "closed"].includes(normalize(row.status))).map((row) => row.id));
  const generatedRequestSources = new Set(existingRequests.map((row) => sourceRequirementId(row.payload)).filter((id): id is string => Boolean(id)));
  const generatedProtocolSources = new Set(existingProtocols.map((row) => sourceRequirementId(row.payload)).filter((id): id is string => Boolean(id)));
  const generatedScheduleSources = new Set(existingSchedule.map((row) => row.constraint_note?.match(/requirement:([0-9a-f-]{36})/i)?.[1] ?? null).filter((id): id is string => Boolean(id)));

  const requestDrafts = requirements.filter((row) => ["material application", "material_application"].includes(normalize(row.requirement_type))).filter((row) => !["approved", "accepted", "closed", "rejected"].includes(normalize(row.status))).filter((row) => !generatedRequestSources.has(row.id)).map((row) => ({
    project_id: input.projectId, title: row.title.toLowerCase().startsWith("wniosek") ? row.title : `Szkic WM — ${row.title}`, status: "draft", payload: { generated_by: "Octopus Autopilot", source_requirement_id: row.id, source_document_id: row.source_document_id, requirement_description: row.description, requires_human_approval: true, candidates: [...materials.slice(0, 8).map((item) => ({ type: "material", id: item.id, name: item.name, installation: item.installation, specification: item.specification })), ...devices.slice(0, 6).map((item) => ({ type: "device", id: item.id, name: item.name, installation: item.installation, parameters: item.parameters }))] }, created_by: input.userId
  }));
  const protocolDrafts = protocolRequirements.filter((row) => !["closed", "rejected", "cancelled"].includes(normalize(row.status))).filter((row) => !generatedProtocolSources.has(row.id)).filter((row) => !existingProtocols.some((protocol) => ["closed", "approved", "complete", "completed"].includes(normalize(protocol.status)) && (normalize(protocol.protocol_type) === normalize(row.protocol_type) || normalize(protocol.title) === normalize(row.title)))).map((row) => ({
    project_id: input.projectId, protocol_type: row.protocol_type, title: row.title, status: "draft", payload: { generated_by: "Octopus Autopilot", source_requirement_id: row.id, trigger_rule: row.trigger_rule, required_evidence: row.required_evidence, result: null, performed_at: null, participants: [], warning: "Octopus przygotował szkic. Wynik pomiaru, faktyczne parametry próby i podpisy wymagają danych z budowy." }, created_by: input.userId
  }));
  const scheduleDrafts = requirements.filter((row) => ["work stage", "work_stage"].includes(normalize(row.requirement_type))).filter((row) => !["approved", "closed", "rejected"].includes(normalize(row.status))).filter((row) => !generatedScheduleSources.has(row.id)).filter((row) => !existingSchedule.some((activity) => normalize(activity.title) === normalize(row.title) && !["cancelled", "superseded"].includes(normalize(activity.status)))).map((row, index) => ({ workspace_id: input.workspaceId, project_id: input.projectId, code: `AI-${String(index + 1).padStart(3, "0")}`, title: row.title, planned_start: null, planned_finish: null, critical: false, constraint_note: `Octopus Autopilot · requirement:${row.id} · terminy wymagają zatwierdzenia baseline`, status: "planned" }));

  const supersededRequestIds = existingRequests.filter((row) => { const source = sourceRequirementId(row.payload); return source && !activeRequirementIds.has(source) && ["draft", "review", "proposed"].includes(normalize(row.status)); }).map((row) => row.id);
  const supersededProtocolIds = existingProtocols.filter((row) => { const source = sourceRequirementId(row.payload); return source && !activeProtocolIds.has(source) && ["draft", "review", "proposed"].includes(normalize(row.status)); }).map((row) => row.id);
  const supersededScheduleIds = existingSchedule.filter((row) => { const source = row.constraint_note?.match(/requirement:([0-9a-f-]{36})/i)?.[1]; return source && !activeRequirementIds.has(source) && ["planned", "draft"].includes(normalize(row.status)); }).map((row) => row.id);

  const writes: Array<PromiseLike<unknown>> = [];
  if (requestDrafts.length) writes.push(supabase.from("material_requests").insert(requestDrafts));
  if (protocolDrafts.length) writes.push(supabase.from("protocols").insert(protocolDrafts));
  if (scheduleDrafts.length) writes.push(supabase.from("schedule_activities").insert(scheduleDrafts));
  if (supersededRequestIds.length) writes.push(supabase.from("material_requests").update({ status: "superseded" }).in("id", supersededRequestIds).eq("project_id", input.projectId));
  if (supersededProtocolIds.length) writes.push(supabase.from("protocols").update({ status: "superseded" }).in("id", supersededProtocolIds).eq("project_id", input.projectId));
  if (supersededScheduleIds.length) writes.push(supabase.from("schedule_activities").update({ status: "superseded" }).in("id", supersededScheduleIds).eq("workspace_id", input.workspaceId).eq("project_id", input.projectId));
  const results = await Promise.all(writes);
  const writeError = results.map((result) => result as { error?: { message: string } | null }).find((result) => result.error)?.error;
  if (writeError) throw new Error(`Autopilot nie zapisał wszystkich szkiców: ${writeError.message}`);

  const summary = { materialDrafts: requestDrafts.length, protocolDrafts: protocolDrafts.length, scheduleDrafts: scheduleDrafts.length, superseded: supersededRequestIds.length + supersededProtocolIds.length + supersededScheduleIds.length, prepared: requestDrafts.length + protocolDrafts.length + scheduleDrafts.length };
  const { error: auditError } = await supabase.from("audit_events").insert({ workspace_id: input.workspaceId, project_id: input.projectId, actor_id: input.userId, actor_type: "ai", event_type: "investment.autopilot.run", entity_type: "project", entity_id: input.projectId, after_value: summary });
  if (auditError) console.error("Project Octopus: autopilot audit event failed", auditError.message);
  return summary;
}
