import "server-only";

import { randomUUID } from "node:crypto";
import { searchBrainHybrid } from "@/lib/ai/brain-retrieval";
import { canExecuteAutonomously, loadAiWorkspacePolicy, recordAiAction, type AiRiskLevel } from "@/lib/ai/control-plane";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type AgentDomain = "investments" | "finance" | "warehouse" | "hr" | "fleet" | "reports";
export type AgentAccess = (domain: AgentDomain, level: "read" | "write", projectId?: string | null) => boolean | Promise<boolean>;
export type AgentExecutionContext = { workspaceId: string; userId: string; traceId: string; canAccess: AgentAccess; modelName?: string | null };

type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "OBJECT", properties, required });
const string = { type: "STRING" };
const number = { type: "NUMBER" };

export const AGENT_TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: "search_documents", description: "Przeszukaj Brain i dokumenty firmy semantycznie i tekstowo. Używaj przed odpowiedzią opartą na dokumentacji.", parameters: objectSchema({ query: string, projectId: string, limit: number }, ["query"]) },
  { name: "get_project_status", description: "Pobierz status inwestycji, terminy, wartość kontraktu, otwarte zadania i ostatnie ryzyka.", parameters: objectSchema({ projectId: string }, ["projectId"]) },
  { name: "get_project_budget", description: "Pobierz wartość kontraktu i zarejestrowane alokacje kosztów inwestycji.", parameters: objectSchema({ projectId: string }, ["projectId"]) },
  { name: "get_warehouse_stock", description: "Pobierz bieżące stany magazynowe. Możesz podać fragment nazwy materiału.", parameters: objectSchema({ query: string, limit: number }) },
  { name: "get_employee_availability", description: "Pobierz aktywnych pracowników i urlopy zachodzące na wskazany okres.", parameters: objectSchema({ dateFrom: string, dateTo: string }, ["dateFrom", "dateTo"]) },
  { name: "get_vehicle_status", description: "Pobierz stan floty, przebiegi, readiness i prognozy serwisowe.", parameters: objectSchema({ query: string, limit: number }) },
  { name: "create_task", description: "Utwórz odwracalne zadanie operacyjne dla inwestycji. Bezpieczna akcja L2.", parameters: objectSchema({ projectId: string, title: string, description: string, priority: string, dueAt: string, confidence: number }, ["projectId", "title"]) },
  { name: "create_material_request", description: "Utwórz szkic wniosku materiałowego. Nie wysyłaj i nie zatwierdzaj go automatycznie.", parameters: objectSchema({ projectId: string, title: string, manufacturer: string, productName: string, model: string, proposedUse: string, complianceSummary: string, stockItemId: string, confidence: number }, ["projectId", "title"]) },
  { name: "create_purchase_draft", description: "Utwórz wyłącznie szkic zamówienia i skieruj go do akceptacji. Nigdy nie oznaczaj go jako ordered/approved.", parameters: objectSchema({ projectId: string, counterpartyId: string, description: string, stockItemId: string, quantity: number, unit: string, unitPrice: number, expectedAt: string, confidence: number }, ["projectId", "description", "quantity"]) },
  { name: "create_protocol_draft", description: "Utwórz szkic protokołu bez wyniku, pomiarów i podpisów. Formalne zatwierdzenie pozostaje człowiekowi.", parameters: objectSchema({ projectId: string, title: string, protocolType: string, scope: string, location: string, confidence: number }, ["projectId", "title"]) },
  { name: "request_approval", description: "Utwórz wpis akceptacji dla istniejącego obiektu kontrolowanego lub wysokiego ryzyka.", parameters: objectSchema({ projectId: string, entityType: string, entityId: string, approvalType: string, note: string }, ["entityType", "entityId", "approvalType"]) }
];

export function geminiAgentTools() { return [{ functionDeclarations: AGENT_TOOL_DEFINITIONS }]; }
const clean = (value: unknown) => typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
function uuidLike(value: unknown) { const valueText = clean(value); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valueText) ? valueText : null; }

function sourceDomain(category: string, sourceType: string): AgentDomain {
  if (sourceType === "knowledge") return "reports";
  if (["warehouse","invoice"].includes(category)) return "warehouse";
  if (category === "hr") return "hr";
  if (category === "fleet") return "fleet";
  return "investments";
}
function toolRisk(name: string): AiRiskLevel {
  if (name.startsWith("get_") || name === "search_documents") return "read";
  if (["create_task","create_material_request","create_protocol_draft"].includes(name)) return "reversible";
  if (["create_purchase_draft","request_approval"].includes(name)) return "controlled";
  return "high";
}
async function requireAccess(ctx: AgentExecutionContext, domain: AgentDomain, level: "read" | "write", projectId?: string | null) {
  if (!await ctx.canAccess(domain, level, projectId)) throw new Error(`OctopusAI nie ma uprawnienia ${level} do domeny ${domain}.`);
}
async function logTool(ctx: AgentExecutionContext, input: { name: string; risk: AiRiskLevel; projectId?: string | null; status: "executed" | "approval_required" | "denied" | "failed"; reversible?: boolean; confidence?: number; args: Record<string, unknown>; output?: Record<string, unknown>; error?: string }) {
  const policy = await loadAiWorkspacePolicy(ctx.workspaceId);
  await recordAiAction({ workspaceId: ctx.workspaceId, projectId: input.projectId, traceId: ctx.traceId, actorId: ctx.userId, toolName: input.name, risk: input.risk, autonomyLevel: policy.autonomyLevel, status: input.status, reversible: input.reversible, confidence: input.confidence, modelName: ctx.modelName, inputPayload: input.args, outputPayload: input.output ?? {}, errorMessage: input.error ?? null });
}
async function approvalFor(ctx: AgentExecutionContext, input: { projectId?: string | null; entityType: string; entityId: string; approvalType: string; note?: string }) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("approvals").insert({ workspace_id: ctx.workspaceId, project_id: input.projectId ?? null, entity_type: input.entityType, entity_id: input.entityId, approval_type: input.approvalType, status: "pending", requested_by: ctx.userId, decision_note: input.note ?? "OctopusAI prosi o zatwierdzenie działania." }).select("id").single<{ id: string }>();
  if (error || !data) throw new Error(`Nie udało się utworzyć akceptacji: ${error?.message ?? "brak ID"}`);
  return data.id;
}

export async function executeAgentTool(ctx: AgentExecutionContext, name: string, rawArgs: Record<string, unknown>) {
  const db = createServiceSupabaseClient();
  const policy = await loadAiWorkspacePolicy(ctx.workspaceId);
  const args = rawArgs ?? {};
  try {
    if (name === "search_documents") {
      const requestedProjectId = uuidLike(args.projectId);
      if (requestedProjectId && !await ctx.canAccess("investments", "read", requestedProjectId)) throw new Error("Brak dostępu do wskazanej inwestycji.");
      const sources = await searchBrainHybrid({ workspaceId: ctx.workspaceId, query: clean(args.query), projectId: requestedProjectId, limit: numeric(args.limit) || 16 });
      const visible = [];
      for (const source of sources) if (await ctx.canAccess(sourceDomain(source.category, source.sourceType), "read", source.projectId)) visible.push(source);
      await logTool(ctx, { name, risk: "read", status: "executed", args, output: { results: visible.length } });
      return { results: visible.slice(0, 20) };
    }

    if (name === "get_project_status" || name === "get_project_budget") {
      const projectId = uuidLike(args.projectId);
      if (!projectId) throw new Error("Nieprawidłowe ID inwestycji.");
      await requireAccess(ctx, name === "get_project_budget" ? "finance" : "investments", "read", projectId);
      const { data: project, error } = await db.from("projects").select("id,name,status,investor_name,location,contract_value,currency,contract_start,contract_end,updated_at").eq("workspace_id", ctx.workspaceId).eq("id", projectId).maybeSingle();
      if (error || !project) throw new Error("Nie znaleziono inwestycji.");
      const [{ data: tasks }, { data: findings }, { data: allocations }] = await Promise.all([
        db.from("tasks").select("id,title,status,priority,due_at").eq("workspace_id", ctx.workspaceId).eq("project_id", projectId).neq("status", "done").order("due_at", { ascending: true }).limit(30),
        db.from("ai_findings").select("id,severity,title,description,status,created_at").eq("project_id", projectId).neq("status", "resolved").order("created_at", { ascending: false }).limit(20),
        db.from("financial_allocations").select("amount,status,allocation_scope,cost_code").eq("workspace_id", ctx.workspaceId).eq("project_id", projectId).limit(1000)
      ]);
      const allocatedCost = (allocations ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
      const result = name === "get_project_budget" ? { project, allocatedCost, allocations: allocations?.length ?? 0 } : { project, openTasks: tasks ?? [], findings: findings ?? [], allocatedCost };
      await logTool(ctx, { name, risk: "read", projectId, status: "executed", args, output: { found: true } });
      return result;
    }

    if (name === "get_warehouse_stock") {
      await requireAccess(ctx, "warehouse", "read");
      const { data: balances, error } = await db.rpc("get_stock_balances", { p_workspace_id: ctx.workspaceId });
      if (error) throw new Error(error.message);
      const query = clean(args.query).toLocaleLowerCase("pl");
      const rows = ((balances ?? []) as Array<Record<string, unknown>>).filter((row) => !query || JSON.stringify(row).toLocaleLowerCase("pl").includes(query)).slice(0, Math.max(1, Math.min(80, numeric(args.limit) || 30)));
      await logTool(ctx, { name, risk: "read", status: "executed", args, output: { results: rows.length } });
      return { results: rows };
    }

    if (name === "get_employee_availability") {
      await requireAccess(ctx, "hr", "read");
      const dateFrom = clean(args.dateFrom), dateTo = clean(args.dateTo);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) throw new Error("Zakres dostępności wymaga dat YYYY-MM-DD.");
      const [{ data: employees }, { data: leaves }] = await Promise.all([
        db.from("employees").select("id,employee_number,first_name,last_name,status").eq("workspace_id", ctx.workspaceId).eq("status", "active").limit(300),
        db.from("leave_requests").select("employee_id,leave_type,start_date,end_date,status").eq("workspace_id", ctx.workspaceId).lte("start_date", dateTo).gte("end_date", dateFrom).in("status", ["approved","pending","in_review"]).limit(500)
      ]);
      await logTool(ctx, { name, risk: "read", status: "executed", args, output: { employees: employees?.length ?? 0, leaves: leaves?.length ?? 0 } });
      return { employees: employees ?? [], absences: leaves ?? [] };
    }

    if (name === "get_vehicle_status") {
      await requireAccess(ctx, "fleet", "read");
      const query = clean(args.query).toLocaleLowerCase("pl");
      const [{ data: vehicles }, { data: predictions }] = await Promise.all([
        db.from("vehicles").select("id,registration_number,make,model,status,current_mileage,readiness_score,readiness_status,warranty_until,updated_at").eq("workspace_id", ctx.workspaceId).limit(300),
        db.from("fleet_maintenance_predictions").select("vehicle_id,prediction_type,predicted_date,risk_probability,confidence,estimated_cost,currency,evidence,status").eq("workspace_id", ctx.workspaceId).in("status", ["new","open"]).limit(300)
      ]);
      const filtered = (vehicles ?? []).filter((row) => !query || JSON.stringify(row).toLocaleLowerCase("pl").includes(query)).slice(0, Math.max(1, Math.min(80, numeric(args.limit) || 30)));
      await logTool(ctx, { name, risk: "read", status: "executed", args, output: { vehicles: filtered.length, predictions: predictions?.length ?? 0 } });
      return { vehicles: filtered, predictions: predictions ?? [] };
    }

    if (name === "create_task") {
      const projectId = uuidLike(args.projectId); if (!projectId) throw new Error("Nieprawidłowa inwestycja.");
      await requireAccess(ctx, "investments", "write", projectId);
      const confidence = numeric(args.confidence) || 0.98;
      if (!canExecuteAutonomously({ policy, risk: "reversible", confidence })) { await logTool(ctx, { name, risk: "reversible", projectId, status: "denied", reversible: true, confidence, args }); return { status: "proposal_only", reason: "Polityka autonomii nie pozwala jeszcze tworzyć zadań automatycznie." }; }
      const { data, error } = await db.from("tasks").insert({ workspace_id: ctx.workspaceId, project_id: projectId, title: clean(args.title).slice(0, 240), description: clean(args.description).slice(0, 4000), status: "open", priority: clean(args.priority) || "medium", source_type: "octopus_ai", due_at: clean(args.dueAt) || null, created_by: ctx.userId }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(error?.message ?? "Nie utworzono zadania.");
      await logTool(ctx, { name, risk: "reversible", projectId, status: "executed", reversible: true, confidence, args, output: { id: data.id } });
      return { status: "created", taskId: data.id };
    }

    if (name === "create_material_request") {
      const projectId = uuidLike(args.projectId); if (!projectId) throw new Error("Nieprawidłowa inwestycja.");
      await requireAccess(ctx, "investments", "write", projectId);
      const confidence = numeric(args.confidence) || 0.98;
      if (!canExecuteAutonomously({ policy, risk: "reversible", confidence })) return { status: "proposal_only", reason: "Polityka autonomii wymaga ręcznego utworzenia szkicu." };
      const { data, error } = await db.rpc("save_material_request_v2_atomic", { p_workspace_id: ctx.workspaceId, p_project_id: projectId, p_request_id: null, p_source_requirement_id: null, p_title: clean(args.title), p_manufacturer: clean(args.manufacturer), p_product_name: clean(args.productName), p_model: clean(args.model), p_proposed_use: clean(args.proposedUse), p_compliance_summary: clean(args.complianceSummary), p_stock_item_id: uuidLike(args.stockItemId), p_boq_item_id: null, p_wbs_node_id: null, p_request_origin: "planned", p_actor_id: ctx.userId });
      if (error || !data) throw new Error(error?.message ?? "Nie utworzono wniosku materiałowego.");
      await logTool(ctx, { name, risk: "reversible", projectId, status: "executed", reversible: true, confidence, args, output: { id: String(data) } });
      return { status: "draft_created", materialRequestId: String(data) };
    }

    if (name === "create_purchase_draft") {
      const projectId = uuidLike(args.projectId); if (!projectId) throw new Error("Nieprawidłowa inwestycja.");
      await requireAccess(ctx, "finance", "write", projectId);
      const quantity = Math.max(0, numeric(args.quantity)), unitPrice = Math.max(0, numeric(args.unitPrice));
      if (!quantity) throw new Error("Ilość zamówienia musi być dodatnia.");
      const orderNumber = `AI-DRAFT-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${randomUUID().slice(0,6).toUpperCase()}`;
      const { data: order, error } = await db.from("purchase_orders").insert({ workspace_id: ctx.workspaceId, project_id: projectId, counterparty_id: uuidLike(args.counterpartyId), order_number: orderNumber, status: "draft", expected_at: clean(args.expectedAt) || null, currency: "PLN", total_amount: quantity * unitPrice, notes: "Szkic utworzony przez OctopusAI. Wymaga zatwierdzenia przed złożeniem zamówienia.", created_by: ctx.userId, destination_mode: "direct_project" }).select("id").single<{ id: string }>();
      if (error || !order) throw new Error(error?.message ?? "Nie utworzono szkicu zamówienia.");
      const { error: lineError } = await db.from("purchase_order_lines").insert({ workspace_id: ctx.workspaceId, purchase_order_id: order.id, stock_item_id: uuidLike(args.stockItemId), description: clean(args.description), quantity, unit: clean(args.unit) || "szt.", unit_price: unitPrice, total_amount: quantity * unitPrice });
      if (lineError) { await db.from("purchase_orders").delete().eq("id", order.id); throw new Error(lineError.message); }
      const approvalId = await approvalFor(ctx, { projectId, entityType: "purchase_order", entityId: order.id, approvalType: "ai_purchase_draft", note: "OctopusAI przygotował szkic zamówienia. Złożenie zamówienia wymaga decyzji człowieka." });
      const confidence = numeric(args.confidence) || 0.98;
      await logTool(ctx, { name, risk: "controlled", projectId, status: "approval_required", reversible: true, confidence, args, output: { orderId: order.id, approvalId } });
      return { status: "draft_created_approval_required", orderId: order.id, approvalId };
    }

    if (name === "create_protocol_draft") {
      const projectId = uuidLike(args.projectId); if (!projectId) throw new Error("Nieprawidłowa inwestycja.");
      await requireAccess(ctx, "investments", "write", projectId);
      const confidence = numeric(args.confidence) || 0.98;
      if (!canExecuteAutonomously({ policy, risk: "reversible", confidence })) return { status: "proposal_only" };
      const { data, error } = await db.rpc("save_protocol_result_atomic", { p_workspace_id: ctx.workspaceId, p_project_id: projectId, p_protocol_id: null, p_protocol_requirement_id: null, p_protocol_type: clean(args.protocolType) || "ai_draft", p_title: clean(args.title), p_protocol_date: null, p_performed_at: null, p_scope: clean(args.scope), p_location: clean(args.location), p_test_medium: "", p_test_pressure: null, p_pressure_unit: "", p_test_duration_minutes: null, p_measurement_device: "", p_result: "", p_remarks: "Szkic OctopusAI — wynik, pomiary i podpisy wymagają formalnego uzupełnienia.", p_participants: [], p_evidence: [], p_actor_id: ctx.userId });
      if (error || !data) throw new Error(error?.message ?? "Nie utworzono szkicu protokołu.");
      await logTool(ctx, { name, risk: "reversible", projectId, status: "executed", reversible: true, confidence, args, output: { id: String(data) } });
      return { status: "draft_created", protocolId: String(data) };
    }

    if (name === "request_approval") {
      const projectId = uuidLike(args.projectId), entityId = uuidLike(args.entityId);
      if (!entityId) throw new Error("Nieprawidłowy identyfikator obiektu do akceptacji.");
      const entityType = clean(args.entityType);
      const domain: AgentDomain = entityType.includes("purchase") || entityType.includes("invoice") ? "finance" : entityType.includes("stock") || entityType.includes("warehouse") ? "warehouse" : entityType.includes("employee") || entityType.includes("leave") ? "hr" : "investments";
      await requireAccess(ctx, domain, "write", projectId);
      const approvalId = await approvalFor(ctx, { projectId, entityType, entityId, approvalType: clean(args.approvalType), note: clean(args.note) });
      await logTool(ctx, { name, risk: "controlled", projectId, status: "approval_required", args, output: { approvalId } });
      return { status: "approval_requested", approvalId };
    }

    throw new Error(`OctopusAI nie zna narzędzia ${name}.`);
  } catch (error) {
    await logTool(ctx, { name, risk: toolRisk(name), status: "failed", args, error: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    throw error;
  }
}
