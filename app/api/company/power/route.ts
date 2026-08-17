import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type PowerAction =
  | "invoice_reassign"
  | "commitment_status"
  | "employment_create"
  | "assignment_create"
  | "reservation_status"
  | "reservation_issue"
  | "stock_item_status"
  | "stock_transfer"
  | "vehicle_allocation_create"
  | "meter_reading_create"
  | "damage_status"
  | "report_definition_status";

type Body = { workspaceId?: string; action?: PowerAction; payload?: Record<string, unknown> };

const ACTION_DOMAIN: Record<PowerAction, Domain> = {
  invoice_reassign: "finance",
  commitment_status: "finance",
  employment_create: "hr",
  assignment_create: "hr",
  reservation_status: "warehouse",
  reservation_issue: "warehouse",
  stock_item_status: "warehouse",
  stock_transfer: "warehouse",
  vehicle_allocation_create: "fleet",
  meter_reading_create: "fleet",
  damage_status: "fleet",
  report_definition_status: "reports"
};

function text(value: unknown, label: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`Uzupełnij pole: ${label}.`);
  return result || null;
}

function date(value: unknown, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) {
    if (required) throw new Error("Uzupełnij wymaganą datę.");
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error("Nieprawidłowy format daty.");
  return result;
}

function amount(value: unknown, label: string, required = false) {
  const raw = value === null || value === undefined || value === "" ? "" : value;
  if (raw === "") {
    if (required) throw new Error(`Uzupełnij pole: ${label}.`);
    return 0;
  }
  const result = parseLocalizedNumber(raw as string | number);
  if (!Number.isFinite(result)) throw new Error(`Nieprawidłowa wartość: ${label}.`);
  return result;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: Body;
  try { body = await request.json() as Body; } catch { return NextResponse.json({ error: "Nieprawidłowe dane operacji." }, { status: 400 }); }
  if (!body.workspaceId || !body.action || !ACTION_DOMAIN[body.action]) return NextResponse.json({ error: "Brakuje firmy lub rodzaju operacji." }, { status: 400 });

  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: ACTION_DOMAIN[body.action], level: "write" })) {
    return NextResponse.json({ error: "Brak uprawnienia do zapisu w tym module." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const p = body.payload ?? {};

  const owned = async (table: string, value: unknown, label: string, optional = false) => {
    const id = text(value, label, !optional);
    if (!id) return null;
    const { data, error } = await db.from(table).select("id").eq("workspace_id", workspace.id).eq("id", id).maybeSingle<{ id: string }>();
    if (error || !data) throw new Error(`${label} nie należy do tej firmy.`);
    return id;
  };

  const currentStock = async (warehouseId: string, stockItemId: string) => {
    const { data: movements, error: movementError } = await db.from("stock_movements").select("id,warehouse_id,target_warehouse_id,movement_type,status").eq("workspace_id", workspace.id).eq("status", "approved");
    if (movementError) throw movementError;
    const ids = (movements ?? []).map((row) => row.id);
    if (!ids.length) return 0;
    const { data: lines, error: lineError } = await db.from("stock_movement_lines").select("movement_id,stock_item_id,quantity").eq("workspace_id", workspace.id).eq("stock_item_id", stockItemId).in("movement_id", ids);
    if (lineError) throw lineError;
    const byId = new Map((movements ?? []).map((row) => [row.id, row]));
    let balance = 0;
    for (const line of lines ?? []) {
      const movement = byId.get(line.movement_id);
      if (!movement) continue;
      const qty = Number(line.quantity ?? 0);
      const type = String(movement.movement_type).toUpperCase();
      if (String(movement.warehouse_id) === warehouseId) {
        if (["PZ", "ZW"].includes(type)) balance += qty;
        if (["WZ", "RW", "MM"].includes(type)) balance -= qty;
      }
      if (type === "MM" && String(movement.target_warehouse_id ?? "") === warehouseId) balance += qty;
    }
    return balance;
  };

  const audit = async (entityType: string, entityId: string, action: string, before: unknown = null, after: unknown = null) => {
    await db.from("audit_events").insert({
      workspace_id: workspace.id,
      actor_id: user.id,
      event_type: `${entityType}.${action}`,
      entity_type: entityType,
      entity_id: entityId,
      before_value: before,
      after_value: after ?? p
    });
  };

  try {
    let id = "";

    if (body.action === "invoice_reassign") {
      const invoiceId = await owned("invoices", p.invoiceId, "Faktura");
      const projectId = p.projectId ? await owned("projects", p.projectId, "Inwestycja", true) : null;
      const { data: invoice, error: invoiceError } = await db.from("invoices").select("gross_amount").eq("workspace_id", workspace.id).eq("id", invoiceId).single<{ gross_amount: number }>();
      if (invoiceError || !invoice) throw new Error("Nie udało się odczytać faktury.");
      const { data: before } = await db.from("financial_allocations").select("id,project_id,amount,status").eq("workspace_id", workspace.id).eq("source_type", "invoice").eq("source_id", invoiceId);
      const { error: deleteError } = await db.from("financial_allocations").delete().eq("workspace_id", workspace.id).eq("source_type", "invoice").eq("source_id", invoiceId);
      if (deleteError) throw deleteError;
      if (projectId) {
        const { error } = await db.from("financial_allocations").insert({ workspace_id: workspace.id, project_id: projectId, source_type: "invoice", source_id: invoiceId, amount: Number(invoice.gross_amount ?? 0), allocation_percent: 100, status: "approved" });
        if (error) throw error;
      }
      id = invoiceId!;
      await audit("invoice", id, "reassigned", before, { projectId });
    } else if (body.action === "commitment_status") {
      const commitmentId = await owned("commitments", p.commitmentId, "Zobowiązanie");
      const status = text(p.status, "status", true)!;
      if (!["open", "approved", "closed", "cancelled"].includes(status)) throw new Error("Nieprawidłowy status zobowiązania.");
      const { data: before } = await db.from("commitments").select("status").eq("workspace_id", workspace.id).eq("id", commitmentId).single();
      const { error } = await db.from("commitments").update({ status }).eq("workspace_id", workspace.id).eq("id", commitmentId);
      if (error) throw error;
      id = commitmentId!;
      await audit("commitment", id, "status_updated", before, { status });
    } else if (body.action === "employment_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const validFrom = date(p.validFrom, true)!;
      const validTo = date(p.validTo);
      if (validTo && validFrom > validTo) throw new Error("Data zakończenia zatrudnienia nie może poprzedzać daty rozpoczęcia.");
      const fte = amount(p.fullTimeEquivalent, "wymiar etatu");
      if (fte < 0 || fte > 2) throw new Error("Wymiar etatu musi mieścić się w zakresie 0–2.");
      const { data, error } = await db.from("employments").insert({
        workspace_id: workspace.id, employee_id: employeeId, employment_type: text(p.employmentType, "forma zatrudnienia", true), position: text(p.position, "stanowisko"),
        valid_from: validFrom, valid_to: validTo, full_time_equivalent: fte || null, monthly_cost: amount(p.monthlyCost, "koszt miesięczny") || null,
        hourly_cost: amount(p.hourlyCost, "koszt godzinowy") || null, currency: "PLN"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie utworzono zatrudnienia.");
      id = data.id;
      await audit("employment", id, "created");
    } else if (body.action === "assignment_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const projectId = await owned("projects", p.projectId, "Inwestycja");
      const dateFrom = date(p.dateFrom);
      const dateTo = date(p.dateTo);
      if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("Początek przypisania nie może być po jego końcu.");
      const allocation = amount(p.allocationPercent, "zaangażowanie", true);
      if (allocation <= 0 || allocation > 100) throw new Error("Zaangażowanie musi mieścić się w zakresie 0–100%.");
      const { data, error } = await db.from("assignments").insert({ workspace_id: workspace.id, employee_id: employeeId, project_id: projectId, role: text(p.role, "rola", true), date_from: dateFrom, date_to: dateTo, allocation_percent: allocation }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie utworzono przypisania.");
      id = data.id;
      await audit("assignment", id, "created");
    } else if (body.action === "reservation_status") {
      const reservationId = await owned("reservations", p.reservationId, "Rezerwacja");
      const status = text(p.status, "status", true)!;
      if (!["open", "fulfilled", "cancelled"].includes(status)) throw new Error("Nieprawidłowy status rezerwacji.");
      const { data: before } = await db.from("reservations").select("status").eq("workspace_id", workspace.id).eq("id", reservationId).single();
      const { error } = await db.from("reservations").update({ status }).eq("workspace_id", workspace.id).eq("id", reservationId);
      if (error) throw error;
      id = reservationId!;
      await audit("reservation", id, "status_updated", before, { status });
    } else if (body.action === "reservation_issue") {
      const reservationId = await owned("reservations", p.reservationId, "Rezerwacja");
      const { data: reservation, error: reservationError } = await db.from("reservations").select("project_id,warehouse_id,stock_item_id,quantity,status").eq("workspace_id", workspace.id).eq("id", reservationId).single();
      if (reservationError || !reservation) throw new Error("Nie udało się odczytać rezerwacji.");
      if (reservation.status !== "open") throw new Error("Tylko otwartą rezerwację można wydać.");
      const available = await currentStock(String(reservation.warehouse_id), String(reservation.stock_item_id));
      const quantity = Number(reservation.quantity ?? 0);
      if (quantity <= 0 || available + 0.000001 < quantity) throw new Error(`Brak wystarczającego stanu. Dostępne: ${available}, wymagane: ${quantity}.`);
      const { data: movement, error: movementError } = await db.from("stock_movements").insert({
        workspace_id: workspace.id, project_id: reservation.project_id, warehouse_id: reservation.warehouse_id, movement_type: "RW",
        document_number: `RW-RES-${String(reservationId).slice(0, 8).toUpperCase()}`, movement_date: new Date().toISOString().slice(0, 10), status: "approved", approved_by: user.id, approved_at: new Date().toISOString()
      }).select("id").single<{ id: string }>();
      if (movementError || !movement) throw movementError ?? new Error("Nie utworzono RW.");
      const { error: lineError } = await db.from("stock_movement_lines").insert({ workspace_id: workspace.id, movement_id: movement.id, stock_item_id: reservation.stock_item_id, quantity });
      if (lineError) { await db.from("stock_movements").delete().eq("id", movement.id); throw lineError; }
      const { error: reservationUpdateError } = await db.from("reservations").update({ status: "fulfilled" }).eq("workspace_id", workspace.id).eq("id", reservationId);
      if (reservationUpdateError) throw reservationUpdateError;
      id = movement.id;
      await audit("reservation", reservationId!, "issued", { status: "open" }, { status: "fulfilled", movementId: id });
    } else if (body.action === "stock_item_status") {
      const stockItemId = await owned("stock_items", p.stockItemId, "Kartoteka");
      const active = p.active === true || p.active === "true";
      const { data: before } = await db.from("stock_items").select("active").eq("workspace_id", workspace.id).eq("id", stockItemId).single();
      const { error } = await db.from("stock_items").update({ active }).eq("workspace_id", workspace.id).eq("id", stockItemId);
      if (error) throw error;
      id = stockItemId!;
      await audit("stock_item", id, "status_updated", before, { active });
    } else if (body.action === "stock_transfer") {
      const warehouseId = await owned("warehouses", p.warehouseId, "Magazyn źródłowy");
      const targetWarehouseId = await owned("warehouses", p.targetWarehouseId, "Magazyn docelowy");
      if (warehouseId === targetWarehouseId) throw new Error("Magazyn źródłowy i docelowy muszą być różne.");
      const stockItemId = await owned("stock_items", p.stockItemId, "Kartoteka");
      const projectId = p.projectId ? await owned("projects", p.projectId, "Inwestycja", true) : null;
      const quantity = amount(p.quantity, "ilość", true);
      if (quantity <= 0) throw new Error("Ilość musi być większa od zera.");
      const available = await currentStock(warehouseId!, stockItemId!);
      if (available + 0.000001 < quantity) throw new Error(`Brak wystarczającego stanu do MM. Dostępne: ${available}.`);
      const { data: movement, error } = await db.from("stock_movements").insert({
        workspace_id: workspace.id, project_id: projectId, warehouse_id: warehouseId, target_warehouse_id: targetWarehouseId, movement_type: "MM",
        document_number: text(p.documentNumber, "numer dokumentu") ?? `MM-${Date.now()}`, movement_date: date(p.movementDate) ?? new Date().toISOString().slice(0, 10), status: "approved", approved_by: user.id, approved_at: new Date().toISOString()
      }).select("id").single<{ id: string }>();
      if (error || !movement) throw error ?? new Error("Nie utworzono MM.");
      const { error: lineError } = await db.from("stock_movement_lines").insert({ workspace_id: workspace.id, movement_id: movement.id, stock_item_id: stockItemId, quantity });
      if (lineError) { await db.from("stock_movements").delete().eq("id", movement.id); throw lineError; }
      id = movement.id;
      await audit("stock_movement", id, "transferred");
    } else if (body.action === "vehicle_allocation_create") {
      const vehicleId = await owned("vehicles", p.vehicleId, "Pojazd");
      const projectId = p.projectId ? await owned("projects", p.projectId, "Inwestycja", true) : null;
      const employeeId = p.employeeId ? await owned("employees", p.employeeId, "Pracownik", true) : null;
      const dateFrom = date(p.dateFrom, true)!;
      const dateTo = date(p.dateTo);
      if (dateTo && dateFrom > dateTo) throw new Error("Koniec alokacji nie może poprzedzać początku.");
      const allocation = amount(p.allocationPercent, "alokacja");
      if (allocation < 0 || allocation > 100) throw new Error("Alokacja musi mieścić się w zakresie 0–100%.");
      const { data, error } = await db.from("vehicle_allocations").insert({
        workspace_id: workspace.id, vehicle_id: vehicleId, project_id: projectId, employee_id: employeeId, date_from: dateFrom, date_to: dateTo,
        allocation_method: text(p.allocationMethod, "metoda") ?? "time", allocation_percent: allocation || null
      }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie utworzono alokacji pojazdu.");
      id = data.id;
      await audit("vehicle_allocation", id, "created");
    } else if (body.action === "meter_reading_create") {
      const vehicleId = await owned("vehicles", p.vehicleId, "Pojazd");
      const readingDate = date(p.readingDate, true)!;
      const mileage = amount(p.mileage, "przebieg", true);
      if (mileage < 0) throw new Error("Przebieg nie może być ujemny.");
      const { data: vehicle, error: vehicleError } = await db.from("vehicles").select("current_mileage").eq("workspace_id", workspace.id).eq("id", vehicleId).single<{ current_mileage: number | null }>();
      if (vehicleError || !vehicle) throw new Error("Nie udało się odczytać pojazdu.");
      if (mileage + 0.001 < Number(vehicle.current_mileage ?? 0)) throw new Error(`Nowy przebieg (${mileage}) nie może być mniejszy od bieżącego (${Number(vehicle.current_mileage ?? 0)}).`);
      const { data, error } = await db.from("meter_readings").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, reading_date: readingDate, mileage, source: "manual" }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie zapisano odczytu.");
      const { error: updateError } = await db.from("vehicles").update({ current_mileage: mileage }).eq("workspace_id", workspace.id).eq("id", vehicleId);
      if (updateError) throw updateError;
      id = data.id;
      await audit("meter_reading", id, "created", { currentMileage: vehicle.current_mileage }, { mileage, readingDate });
    } else if (body.action === "damage_status") {
      const damageId = await owned("damage_cases", p.damageId, "Szkoda");
      const status = text(p.status, "status", true)!;
      if (!["reported", "in_progress", "closed", "cancelled"].includes(status)) throw new Error("Nieprawidłowy status szkody.");
      const { data: before } = await db.from("damage_cases").select("status").eq("workspace_id", workspace.id).eq("id", damageId).single();
      const { error } = await db.from("damage_cases").update({ status }).eq("workspace_id", workspace.id).eq("id", damageId);
      if (error) throw error;
      id = damageId!;
      await audit("damage_case", id, "status_updated", before, { status });
    } else if (body.action === "report_definition_status") {
      const definitionId = await owned("report_definitions", p.definitionId, "Definicja raportu");
      const active = p.active === true || p.active === "true";
      const { data: before } = await db.from("report_definitions").select("active").eq("workspace_id", workspace.id).eq("id", definitionId).single();
      const { error } = await db.from("report_definitions").update({ active }).eq("workspace_id", workspace.id).eq("id", definitionId);
      if (error) throw error;
      id = definitionId!;
      await audit("report_definition", id, "status_updated", before, { active });
    }

    if (!id) throw new Error("Operacja nie zmieniła danych.");
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się wykonać operacji.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
