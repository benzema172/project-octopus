import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = { workspaceId?: string; action?: string; payload?: Record<string, unknown> };
type Level = "write" | "approve";
const APPROVE = new Set(["autonomous_replenishment", "return_status", "shipment_status", "recommendation_status", "integration_disable"]);
const ITEM_STRATEGIES = new Set(["fifo", "fefo", "lifo"]);
const REORDER_POLICIES = new Set(["manual", "minmax", "forecast", "project_demand"]);
const TASK_TYPES = new Set(["putaway", "pick", "replenish_pickface", "crossdock", "count", "move", "pack", "dispatch", "return_inspection"]);
const TASK_STATUSES = new Set(["open", "assigned", "in_progress", "done", "cancelled", "blocked"]);
const LOT_STATUSES = new Set(["available", "reserved", "quarantine", "expired", "consumed", "blocked"]);
const RETURN_STATUSES = new Set(["draft", "submitted", "approved", "in_transit", "received", "credited", "closed", "rejected"]);
const SHIPMENT_STATUSES = new Set(["draft", "ready", "dispatched", "in_transit", "delivered", "exception", "cancelled"]);
const UNIT_STATUSES = new Set(["open", "sealed", "staged", "shipped", "consumed", "quarantine"]);
const s = (v: unknown) => typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
const n = (v: unknown) => { if (v === undefined || v === null || v === "") return null; const x = Number(String(v).replace(/\s/g, "").replace(",", ".")); if (!Number.isFinite(x)) throw new Error("Nieprawidłowa wartość liczbowa."); return x; };
const d = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : null;
const ts = (v: unknown) => { if (!s(v)) return null; const x = new Date(s(v)); return Number.isNaN(x.getTime()) ? null : x.toISOString(); };
const bool = (v: unknown) => v === true || ["1", "true", "yes", "tak", "on"].includes(s(v).toLowerCase());
const csv = (v: unknown) => s(v).split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0, 100);
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

async function owned(table: string, value: unknown, workspaceId: string, label: string, optional = false) {
  const id = s(value);
  if (!id && optional) return null;
  if (!id) throw new Error(`Wybierz: ${label}.`);
  const { data, error } = await createServiceSupabaseClient().from(table).select("id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle<{ id: string }>();
  if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`);
  return id;
}

async function audit(workspaceId: string, userId: string, action: string, entityId: string, payload: Record<string, unknown>) {
  await createServiceSupabaseClient().from("audit_events").insert({
    workspace_id: workspaceId, actor_id: userId, event_type: `warehouse400.${action}`,
    entity_type: "warehouse400", entity_id: entityId, after_value: payload
  });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  let body: Body;
  try { body = await readJsonBody<Body>(request); }
  catch (error) { if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
  if (!body.workspaceId || !body.action || !body.payload) return NextResponse.json({ error: "Brakuje firmy, operacji lub danych." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const level: Level = APPROVE.has(body.action) ? "approve" : "write";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "warehouse", level })) {
    return NextResponse.json({ error: level === "approve" ? "Brak uprawnienia do zatwierdzania decyzji Magazynu." : "Brak uprawnienia do zapisu w Magazynie." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const p = body.payload;
  try {
    let id = "";
    let result: unknown;
    let issuedSecret: string | undefined;

    if (body.action === "item_planning_update") {
      id = (await owned("stock_items", p.stockItemId, workspace.id, "Kartoteka"))!;
      const strategy = s(p.stockStrategy) || "fifo";
      const reorder = s(p.reorderPolicy) || "manual";
      if (!ITEM_STRATEGIES.has(strategy) || !REORDER_POLICIES.has(reorder)) throw new Error("Nieprawidłowa strategia zapasu.");
      const patch = {
        stock_strategy: strategy, lot_tracking: bool(p.lotTracking), expiry_tracking: bool(p.expiryTracking), gtin: s(p.gtin) || null,
        gs1_enabled: bool(p.gs1Enabled), lead_time_days: n(p.leadTimeDays), service_level_pct: n(p.serviceLevelPct), reorder_policy: reorder,
        dynamic_min_stock: n(p.dynamicMinStock), dynamic_max_stock: n(p.dynamicMaxStock), shelf_life_days: n(p.shelfLifeDays), updated_at: new Date().toISOString()
      };
      const { error } = await db.from("stock_items").update(patch).eq("workspace_id", workspace.id).eq("id", id); if (error) throw error;
    } else if (body.action === "lot_status") {
      id = (await owned("stock_lots", p.lotId, workspace.id, "Partia"))!;
      const status = s(p.status); if (!LOT_STATUSES.has(status)) throw new Error("Nieprawidłowy status partii.");
      const { error } = await db.from("stock_lots").update({ status, updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", id); if (error) throw error;
    } else if (body.action === "logistic_unit_create") {
      const warehouseId = (await owned("warehouses", p.warehouseId, workspace.id, "Magazyn"))!;
      const locationId = await owned("warehouse_locations", p.locationId, workspace.id, "Lokalizacja", true);
      const parentId = await owned("warehouse_logistic_units", p.parentId, workspace.id, "Jednostka nadrzędna", true);
      const { data, error } = await db.from("warehouse_logistic_units").insert({
        workspace_id: workspace.id, warehouse_id: warehouseId, location_id: locationId, parent_id: parentId,
        unit_type: s(p.unitType) || "pallet", sscc: s(p.sscc) || null, label_code: s(p.labelCode) || null,
        gross_weight_kg: n(p.grossWeightKg), volume_m3: n(p.volumeM3), metadata: { note: s(p.note) }
      }).select("id").single<{ id: string }>(); if (error) throw error; id = data.id;
    } else if (body.action === "logistic_unit_status") {
      id = (await owned("warehouse_logistic_units", p.logisticUnitId, workspace.id, "Jednostka logistyczna"))!;
      const status = s(p.status); if (!UNIT_STATUSES.has(status)) throw new Error("Nieprawidłowy status jednostki logistycznej.");
      const { error } = await db.from("warehouse_logistic_units").update({ status, updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", id); if (error) throw error;
    } else if (body.action === "logistic_unit_item_add") {
      const logisticUnitId = (await owned("warehouse_logistic_units", p.logisticUnitId, workspace.id, "Jednostka logistyczna"))!;
      const stockItemId = (await owned("stock_items", p.stockItemId, workspace.id, "Kartoteka"))!;
      const lotId = await owned("stock_lots", p.lotId, workspace.id, "Partia", true);
      const quantity = n(p.quantity); if (quantity === null || quantity <= 0) throw new Error("Ilość musi być większa od zera.");
      const { data, error } = await db.from("warehouse_logistic_unit_items").insert({ workspace_id: workspace.id, logistic_unit_id: logisticUnitId, stock_item_id: stockItemId, lot_id: lotId, quantity, unit: s(p.unit) || null }).select("id").single<{ id: string }>(); if (error) throw error; id = data.id;
    } else if (body.action === "task_create") {
      const warehouseId = (await owned("warehouses", p.warehouseId, workspace.id, "Magazyn"))!;
      const taskType = s(p.taskType); if (!TASK_TYPES.has(taskType)) throw new Error("Nieprawidłowy typ zadania WMS.");
      const stockItemId = await owned("stock_items", p.stockItemId, workspace.id, "Kartoteka", true);
      const lotId = await owned("stock_lots", p.lotId, workspace.id, "Partia", true);
      const logisticUnitId = await owned("warehouse_logistic_units", p.logisticUnitId, workspace.id, "Jednostka logistyczna", true);
      const sourceLocationId = await owned("warehouse_locations", p.sourceLocationId, workspace.id, "Lokalizacja źródłowa", true);
      const targetLocationId = await owned("warehouse_locations", p.targetLocationId, workspace.id, "Lokalizacja docelowa", true);
      const projectId = await owned("projects", p.projectId, workspace.id, "Inwestycja", true);
      const assignedEmployeeId = await owned("employees", p.assignedEmployeeId, workspace.id, "Pracownik", true);
      const { data, error } = await db.from("warehouse_tasks").insert({
        workspace_id: workspace.id, warehouse_id: warehouseId, task_type: taskType, priority: n(p.priority) ?? 50,
        stock_item_id: stockItemId, lot_id: lotId, logistic_unit_id: logisticUnitId, quantity: n(p.quantity), source_location_id: sourceLocationId,
        target_location_id: targetLocationId, project_id: projectId, assigned_employee_id: assignedEmployeeId,
        status: assignedEmployeeId ? "assigned" : "open", instructions: s(p.instructions) || null, created_by: user.id
      }).select("id").single<{ id: string }>(); if (error) throw error; id = data.id;
    } else if (body.action === "task_assign") {
      id = (await owned("warehouse_tasks", p.taskId, workspace.id, "Zadanie WMS"))!;
      const employeeId = (await owned("employees", p.employeeId, workspace.id, "Pracownik"))!;
      const { error } = await db.from("warehouse_tasks").update({ assigned_employee_id: employeeId, status: "assigned", updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", id); if (error) throw error;
    } else if (body.action === "task_status") {
      id = (await owned("warehouse_tasks", p.taskId, workspace.id, "Zadanie WMS"))!;
      const status = s(p.status); if (!TASK_STATUSES.has(status)) throw new Error("Nieprawidłowy status zadania.");
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === "in_progress") patch.started_at = new Date().toISOString(); if (status === "done") patch.completed_at = new Date().toISOString();
      const { error } = await db.from("warehouse_tasks").update(patch).eq("workspace_id", workspace.id).eq("id", id); if (error) throw error;
    } else if (body.action === "crossdock_create") {
      const inboundLineId = s(p.inboundMovementLineId); if (!inboundLineId) throw new Error("Podaj pozycję przyjęcia źródłowego.");
      const inbound = await db.from("stock_movement_lines").select("id,stock_item_id").eq("workspace_id", workspace.id).eq("id", inboundLineId).maybeSingle<{ id: string; stock_item_id: string }>();
      if (inbound.error || !inbound.data) throw new Error("Pozycja przyjęcia nie należy do firmy.");
      const projectId = await owned("projects", p.projectId, workspace.id, "Inwestycja", true); const quantity = n(p.quantity); if (quantity === null || quantity <= 0) throw new Error("Ilość musi być większa od zera.");
      const { data, error } = await db.from("warehouse_crossdock_links").insert({ workspace_id: workspace.id, inbound_movement_line_id: inboundLineId, stock_item_id: inbound.data.stock_item_id, project_id: projectId, quantity }).select("id").single<{ id: string }>(); if (error) throw error; id = data.id;
    } else if (body.action === "return_create") {
      const counterpartyId = await owned("counterparties", p.counterpartyId, workspace.id, "Kontrahent", true); const projectId = await owned("projects", p.projectId, workspace.id, "Inwestycja", true);
      const number = s(p.returnNumber) || `RMA-${Date.now()}`; const type = s(p.returnType) || "supplier";
      if (!["supplier", "customer", "internal", "warranty"].includes(type)) throw new Error("Nieprawidłowy typ zwrotu.");
      const { data, error } = await db.from("warehouse_returns").insert({ workspace_id: workspace.id, return_number: number, return_type: type, counterparty_id: counterpartyId, project_id: projectId, reason: s(p.reason) || null, rma_number: s(p.rmaNumber) || null, requested_at: d(p.requestedAt) ?? new Date().toISOString().slice(0, 10), created_by: user.id }).select("id").single<{ id: string }>(); if (error) throw error; id = data.id;
    } else if (body.action === "return_line_add") {
      const returnId = (await owned("warehouse_returns", p.returnId, workspace.id, "Zwrot"))!; const stockItemId = (await owned("stock_items", p.stockItemId, workspace.id, "Kartoteka"))!; const lotId = await owned("stock_lots", p.lotId, workspace.id, "Partia", true);
      const quantity = n(p.quantity); if (quantity === null || quantity <= 0) throw new Error("Ilość musi być większa od zera.");
      const { data, error } = await db.from("warehouse_return_lines").insert({ workspace_id: workspace.id, return_id: returnId, stock_item_id: stockItemId, lot_id: lotId, quantity, unit: s(p.unit) || null, reason: s(p.reason) || null }).select("id").single<{ id: string }>(); if (error) throw error; id = data.id;
    } else if (body.action === "return_status") {
      id = (await owned("warehouse_returns", p.returnId, workspace.id, "Zwrot"))!; const status = s(p.status); if (!RETURN_STATUSES.has(status)) throw new Error("Nieprawidłowy status zwrotu.");
      const { error } = await db.from("warehouse_returns").update({ status, closed_at: status === "closed" ? new Date().toISOString().slice(0, 10) : null, updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", id); if (error) throw error;
    } else if (body.action === "shipment_create") {
      const warehouseId = (await owned("warehouses", p.warehouseId, workspace.id, "Magazyn"))!; const projectId = await owned("projects", p.projectId, workspace.id, "Inwestycja", true); const counterpartyId = await owned("counterparties", p.counterpartyId, workspace.id, "Kontrahent", true);
      const direction = s(p.direction) || "outbound"; if (!["inbound", "outbound"].includes(direction)) throw new Error("Nieprawidłowy kierunek przesyłki.");
      const { data, error } = await db.from("warehouse_shipments").insert({ workspace_id: workspace.id, warehouse_id: warehouseId, project_id: projectId, counterparty_id: counterpartyId, shipment_number: s(p.shipmentNumber) || `SHIP-${Date.now()}`, direction, carrier: s(p.carrier) || null, service_level: s(p.serviceLevel) || null, tracking_number: s(p.trackingNumber) || null, planned_at: ts(p.plannedAt), metadata: { note: s(p.note) } }).select("id").single<{ id: string }>(); if (error) throw error; id = data.id;
    } else if (body.action === "shipment_status") {
      id = (await owned("warehouse_shipments", p.shipmentId, workspace.id, "Przesyłka"))!; const status = s(p.status); if (!SHIPMENT_STATUSES.has(status)) throw new Error("Nieprawidłowy status przesyłki.");
      const patch: Record<string, unknown> = { status, tracking_number: s(p.trackingNumber) || undefined, updated_at: new Date().toISOString() };
      if (status === "dispatched") patch.dispatched_at = new Date().toISOString(); if (status === "delivered") patch.delivered_at = new Date().toISOString();
      const { error } = await db.from("warehouse_shipments").update(patch).eq("workspace_id", workspace.id).eq("id", id); if (error) throw error;
    } else if (body.action === "integration_create") {
      issuedSecret = randomBytes(32).toString("base64url");
      const { data, error } = await db.from("warehouse_integrations").insert({ workspace_id: workspace.id, provider: s(p.provider) || "generic", name: s(p.name) || "Integracja WMS", mode: s(p.mode) || "webhook", capabilities: csv(p.capabilities), config: { notes: s(p.notes) }, created_by: user.id }).select("id").single<{ id: string }>(); if (error) throw error; id = data.id;
      const rpc = await db.rpc("set_warehouse_integration_secret_hash_400", { p_workspace_id: workspace.id, p_integration_id: id, p_secret_hash: hash(issuedSecret) }); if (rpc.error) throw rpc.error;
    } else if (body.action === "integration_rotate_secret") {
      id = (await owned("warehouse_integrations", p.integrationId, workspace.id, "Integracja"))!; issuedSecret = randomBytes(32).toString("base64url");
      const rpc = await db.rpc("set_warehouse_integration_secret_hash_400", { p_workspace_id: workspace.id, p_integration_id: id, p_secret_hash: hash(issuedSecret) }); if (rpc.error) throw rpc.error;
    } else if (body.action === "integration_disable") {
      id = (await owned("warehouse_integrations", p.integrationId, workspace.id, "Integracja"))!; const { error } = await db.from("warehouse_integrations").update({ status: "disabled", updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", id); if (error) throw error;
    } else if (body.action === "mobile_scan_event") {
      const warehouseId = await owned("warehouses", p.warehouseId, workspace.id, "Magazyn", true); const locationId = await owned("warehouse_locations", p.locationId, workspace.id, "Lokalizacja", true); const stockItemId = await owned("stock_items", p.stockItemId, workspace.id, "Kartoteka", true); const logisticUnitId = await owned("warehouse_logistic_units", p.logisticUnitId, workspace.id, "Jednostka logistyczna", true);
      const code = s(p.code); if (!code) throw new Error("Brak kodu skanowania.");
      const { data, error } = await db.from("warehouse_device_events").insert({ workspace_id: workspace.id, event_type: "scan", external_event_id: s(p.eventId) || null, warehouse_id: warehouseId, location_id: locationId, stock_item_id: stockItemId, logistic_unit_id: logisticUnitId, occurred_at: ts(p.occurredAt) ?? new Date().toISOString(), payload: { code, source: "mobile_offline_queue", quantity: n(p.quantity), note: s(p.note) }, processed: false }).select("id").single<{ id: string }>(); if (error?.code === "23505") { id = s(p.eventId) || code; result = { duplicate: true }; } else { if (error) throw error; id = data.id; }
    } else if (body.action === "refresh_intelligence") {
      const rpc = await db.rpc("warehouse_digital_worker_400", { p_workspace_id: workspace.id, p_reference_date: d(p.referenceDate) ?? new Date().toISOString().slice(0, 10) }); if (rpc.error) throw rpc.error; id = workspace.id; result = rpc.data;
    } else if (body.action === "autonomous_replenishment") {
      const stockItemId = (await owned("stock_items", p.stockItemId, workspace.id, "Kartoteka"))!; const projectId = await owned("projects", p.projectId, workspace.id, "Inwestycja", true); const counterpartyId = await owned("counterparties", p.counterpartyId, workspace.id, "Dostawca", true);
      const rpc = await db.rpc("prepare_warehouse_autonomous_replenishment_400", { p_workspace_id: workspace.id, p_stock_item_id: stockItemId, p_project_id: projectId, p_counterparty_id: counterpartyId, p_actor_id: user.id }); if (rpc.error) throw rpc.error; id = String(rpc.data); result = { purchaseOrderId: rpc.data, status: "draft", requiresHumanApproval: true };
    } else if (body.action === "recommendation_status") {
      id = (await owned("warehouse_ai_recommendations", p.recommendationId, workspace.id, "Rekomendacja"))!; const status = s(p.status); if (!["accepted", "dismissed", "executed"].includes(status)) throw new Error("Nieprawidłowy status rekomendacji.");
      const { error } = await db.from("warehouse_ai_recommendations").update({ status, resolved_by: user.id, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", id); if (error) throw error;
    } else {
      return NextResponse.json({ error: "Nieobsługiwana operacja Magazynu 4.0." }, { status: 400 });
    }

    if (!id) throw new Error("Operacja nie zwróciła identyfikatora.");
    await audit(workspace.id, user.id, body.action, id, p);
    return NextResponse.json({ ok: true, id, result, issuedSecret });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operacja Magazynu 4.0 nie powiodła się." }, { status: 422 });
  }
}
