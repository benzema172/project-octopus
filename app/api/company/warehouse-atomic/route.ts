import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { inferWarehouseMovementType } from "@/lib/warehouse/domain";

export const runtime = "nodejs";

type Body = { workspaceId?: string; entity?: string; payload?: Record<string, unknown> };

const ACTIONS = new Set([
  "ai_warehouse_import",
  "reservation",
  "stock_movement_destination",
  "stock_movement_approve",
  "inventory_count_create",
  "inventory_count_line",
  "inventory_count_approve",
  "stock_instance_create",
  "stock_instance_assign",
  "stock_instance_return",
  "stock_instance_service",
  "material_alias"
]);
const APPROVAL_ACTIONS = new Set(["stock_movement_approve", "inventory_count_approve"]);

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const nullable = (value: unknown) => clean(value) || null;
const validDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(clean(value)) ? clean(value) : null;
const optionalNumber = (value: unknown) => value === undefined || value === null || value === "" ? null : parseLocalizedNumber(value);

async function ownedId(table: string, id: unknown, workspaceId: string, label: string) {
  const value = clean(id);
  if (!value) throw new Error(`Uzupełnij pole: ${label}.`);
  const { data, error } = await createServiceSupabaseClient().from(table).select("id").eq("workspace_id", workspaceId).eq("id", value).maybeSingle<{ id: string }>();
  if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`);
  return value;
}

async function optionalOwnedId(table: string, id: unknown, workspaceId: string, label: string) {
  return clean(id) ? ownedId(table, id, workspaceId, label) : null;
}

async function loadBusinessDocument(workspaceId: string, documentIdValue: unknown) {
  const documentId = await ownedId("documents", documentIdValue, workspaceId, "Dokument źródłowy");
  const { data, error } = await createServiceSupabaseClient().from("document_extractions")
    .select("payload,status")
    .eq("workspace_id", workspaceId)
    .eq("document_id", documentId)
    .eq("extraction_type", "document_context")
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ payload: Record<string, unknown>; status: string }>();
  if (error || !data) throw new Error("Dokument nie ma gotowego odczytu AI.");
  const business = data.payload?.businessDocument;
  if (!business || typeof business !== "object") throw new Error("AI nie odczytało danych handlowych dokumentu.");
  return { documentId, business: business as Record<string, unknown> };
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: Body;
  try {
    body = await readJsonBody<Body>(request);
  } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  if (!body.workspaceId || !body.entity || !body.payload) return NextResponse.json({ error: "Brakuje firmy, operacji lub danych." }, { status: 400 });
  if (!ACTIONS.has(body.entity)) return NextResponse.json({ error: "Ta operacja nie jest obsługiwana przez atomowy moduł magazynu." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });

  const p = body.payload;
  const projectId = nullable(p.projectId);
  const level = APPROVAL_ACTIONS.has(body.entity) ? "approve" : "write";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "warehouse", level, projectId })) {
    return NextResponse.json({ error: "Brak uprawnienia do tej operacji Magazynu." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  try {
    if (body.entity === "stock_movement_destination") {
      const movementId = await ownedId("stock_movements", p.movementId, workspace.id, "Ruch magazynowy");
      const destinationMode = clean(p.destinationMode);
      if (!new Set(["direct_project", "central_stock"]).has(destinationMode)) throw new Error("Wybierz prawidłowe miejsce dostawy.");
      const targetProject = destinationMode === "direct_project" ? await ownedId("projects", p.projectId, workspace.id, "Inwestycja") : null;
      const { data, error } = await db.rpc("set_stock_movement_destination_atomic", { p_workspace_id: workspace.id, p_movement_id: movementId, p_destination_mode: destinationMode, p_project_id: targetProject, p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data), destinationMode });
    }

    if (body.entity === "stock_movement_approve") {
      const movementId = await ownedId("stock_movements", p.movementId, workspace.id, "Ruch magazynowy");
      const { data, error } = await db.rpc("approve_stock_movement_atomic", { p_workspace_id: workspace.id, p_movement_id: movementId, p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data ?? movementId) });
    }

    if (body.entity === "reservation") {
      const verifiedProject = await ownedId("projects", p.projectId, workspace.id, "Inwestycja");
      const warehouseId = await ownedId("warehouses", p.warehouseId, workspace.id, "Magazyn");
      const stockItemId = await ownedId("stock_items", p.stockItemId, workspace.id, "Kartoteka");
      const quantity = parseLocalizedNumber(p.quantity);
      if (quantity <= 0) throw new Error("Ilość rezerwacji musi być większa od zera.");
      const { data, error } = await db.rpc("create_reservation_atomic", { p_workspace_id: workspace.id, p_project_id: verifiedProject, p_warehouse_id: warehouseId, p_stock_item_id: stockItemId, p_quantity: quantity, p_required_at: validDate(p.requiredAt), p_actor_id: user.id }).single<{ result_id: string }>();
      if (error || !data) throw new Error(error?.message ?? "Nie udało się atomowo utworzyć rezerwacji.");
      return NextResponse.json({ ok: true, id: data.result_id });
    }

    if (body.entity === "inventory_count_create") {
      const warehouseId = await ownedId("warehouses", p.warehouseId, workspace.id, "Magazyn");
      const { data, error } = await db.rpc("start_inventory_count_atomic", { p_workspace_id: workspace.id, p_warehouse_id: warehouseId, p_count_date: validDate(p.countDate), p_notes: nullable(p.notes), p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data) });
    }

    if (body.entity === "inventory_count_line") {
      const lineId = await ownedId("inventory_count_lines", p.lineId, workspace.id, "Pozycja spisu");
      const countedQuantity = parseLocalizedNumber(p.countedQuantity);
      if (countedQuantity < 0) throw new Error("Stan policzony nie może być ujemny.");
      const { data, error } = await db.rpc("update_inventory_count_line_atomic", { p_workspace_id: workspace.id, p_line_id: lineId, p_counted_quantity: countedQuantity, p_note: nullable(p.note), p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data) });
    }

    if (body.entity === "inventory_count_approve") {
      const countId = await ownedId("inventory_counts", p.countId, workspace.id, "Inwentaryzacja");
      const { data, error } = await db.rpc("approve_inventory_count_atomic", { p_workspace_id: workspace.id, p_count_id: countId, p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data) });
    }

    if (body.entity === "stock_instance_create") {
      const stockItemId = await ownedId("stock_items", p.stockItemId, workspace.id, "Kartoteka");
      const warehouseId = await optionalOwnedId("warehouses", p.warehouseId, workspace.id, "Magazyn");
      const { data, error } = await db.rpc("create_stock_instance_atomic", {
        p_workspace_id: workspace.id, p_stock_item_id: stockItemId, p_warehouse_id: warehouseId,
        p_serial_number: clean(p.serialNumber), p_asset_tag: nullable(p.assetTag), p_purchase_date: validDate(p.purchaseDate),
        p_purchase_price: optionalNumber(p.purchasePrice), p_warranty_until: validDate(p.warrantyUntil),
        p_condition: nullable(p.condition), p_notes: nullable(p.notes), p_actor_id: user.id
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data) });
    }

    if (body.entity === "stock_instance_assign") {
      const instanceId = await ownedId("stock_item_instances", p.instanceId, workspace.id, "Egzemplarz");
      const employeeId = await optionalOwnedId("employees", p.employeeId, workspace.id, "Pracownik");
      const targetProjectId = await optionalOwnedId("projects", p.projectId, workspace.id, "Inwestycja");
      const vehicleId = await optionalOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { data, error } = await db.rpc("assign_stock_instance_atomic", { p_workspace_id: workspace.id, p_instance_id: instanceId, p_employee_id: employeeId, p_project_id: targetProjectId, p_vehicle_id: vehicleId, p_event_date: validDate(p.eventDate), p_condition: nullable(p.condition), p_notes: nullable(p.notes), p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data) });
    }

    if (body.entity === "stock_instance_return") {
      const instanceId = await ownedId("stock_item_instances", p.instanceId, workspace.id, "Egzemplarz");
      const warehouseId = await ownedId("warehouses", p.warehouseId, workspace.id, "Magazyn zwrotu");
      const { data, error } = await db.rpc("return_stock_instance_atomic", { p_workspace_id: workspace.id, p_instance_id: instanceId, p_warehouse_id: warehouseId, p_event_date: validDate(p.eventDate), p_condition: nullable(p.condition), p_notes: nullable(p.notes), p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data) });
    }

    if (body.entity === "stock_instance_service") {
      const instanceId = await ownedId("stock_item_instances", p.instanceId, workspace.id, "Egzemplarz");
      const cost = optionalNumber(p.cost);
      if (cost !== null && cost < 0) throw new Error("Koszt serwisu nie może być ujemny.");
      const { data, error } = await db.rpc("record_stock_instance_service_atomic", { p_workspace_id: workspace.id, p_instance_id: instanceId, p_event_date: validDate(p.eventDate), p_next_service_date: validDate(p.nextServiceDate), p_cost: cost, p_condition: nullable(p.condition), p_notes: nullable(p.notes), p_actor_id: user.id });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: String(data) });
    }

    if (body.entity === "material_alias") {
      const stockItemId = await ownedId("stock_items", p.stockItemId, workspace.id, "Kartoteka");
      const counterpartyId = await optionalOwnedId("counterparties", p.counterpartyId, workspace.id, "Dostawca");
      const supplierName = clean(p.supplierName);
      if (!supplierName) throw new Error("Nazwa materiału u dostawcy jest wymagana.");
      const { data: normalized, error: normalizeError } = await db.rpc("normalize_material_key", { p_value: supplierName });
      if (normalizeError || !normalized) throw new Error(normalizeError?.message ?? "Nie udało się znormalizować nazwy materiału.");
      const { data, error } = await db.from("material_aliases").insert({ workspace_id: workspace.id, stock_item_id: stockItemId, counterparty_id: counterpartyId, supplier_sku: nullable(p.supplierSku), supplier_name: supplierName, normalized_key: String(normalized), confidence: 1, status: "approved", created_by: user.id }).select("id").single<{ id: string }>();
      if (error || !data) throw new Error(error?.code === "23505" ? "Taki alias jest już przypisany." : error?.message ?? "Nie udało się zapisać aliasu.");
      return NextResponse.json({ ok: true, id: data.id });
    }

    const source = await loadBusinessDocument(workspace.id, p.documentId);
    const verifiedProject = projectId ? await ownedId("projects", projectId, workspace.id, "Inwestycja") : null;
    const warehouseId = p.warehouseId ? await ownedId("warehouses", p.warehouseId, workspace.id, "Magazyn") : null;
    const lines = Array.isArray(source.business.lines) ? source.business.lines.filter((line) => line && typeof line === "object") : [];
    if (!lines.length) throw new Error("AI nie odczytało pozycji materiałowych. Sprawdź dokument lub dodaj ruch ręcznie.");
    const direction = clean(source.business.direction).toLowerCase();
    const movementType = inferWarehouseMovementType(direction, p.movementType);
    const { data, error } = await db.rpc("import_ai_warehouse_document_atomic", {
      p_workspace_id: workspace.id, p_project_id: verifiedProject, p_warehouse_id: warehouseId,
      p_source_document_id: source.documentId, p_document_number: nullable(source.business.documentNumber),
      p_movement_date: validDate(source.business.issueDate), p_movement_type: movementType, p_lines: lines, p_actor_id: user.id
    });
    if (error || !data) throw new Error(error?.message ?? "Nie udało się atomowo zaczytać dokumentu magazynowego.");
    if (verifiedProject) {
      const { error: assignmentError } = await db.rpc("assign_document_to_project_atomic", { p_workspace_id: workspace.id, p_document_id: source.documentId, p_project_id: verifiedProject, p_actor_id: user.id });
      if (assignmentError) throw new Error(`Utworzono szkic ruchu, ale nie przypisano dokumentu do inwestycji: ${assignmentError.message}`);
    }
    return NextResponse.json({ ok: true, id: String(data), movementType });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się zapisać operacji magazynowej." }, { status: 422 });
  }
}
