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

function periodsOverlap(fromA: string, toA: string | null, fromB: string, toB: string | null) {
  const endA = toA ?? "9999-12-31";
  const endB = toB ?? "9999-12-31";
  return fromA <= endB && fromB <= endA;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane operacji." }, { status: 400 });
  }

  if (!body.workspaceId || !body.action || !ACTION_DOMAIN[body.action]) {
    return NextResponse.json({ error: "Brakuje firmy lub rodzaju operacji." }, { status: 400 });
  }

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
    let meta: Record<string, unknown> = {};

    if (body.action === "invoice_reassign") {
      const invoiceId = await owned("invoices", p.invoiceId, "Faktura");
      const projectId = p.projectId ? await owned("projects", p.projectId, "Inwestycja", true) : null;
      const { data, error } = await db.rpc("reassign_invoice_atomic", {
        p_workspace_id: workspace.id,
        p_invoice_id: invoiceId,
        p_project_id: projectId,
        p_actor_id: user.id
      });
      if (error) throw new Error(`Nie udało się atomowo zmienić przypisania faktury: ${error.message}`);
      id = String(data ?? invoiceId);
      meta = { projectId };
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
      const { data: existingTerms, error: termsError } = await db.from("employments").select("id,valid_from,valid_to").eq("workspace_id", workspace.id).eq("employee_id", employeeId);
      if (termsError) throw termsError;
      const overlap = (existingTerms ?? []).some((term) => periodsOverlap(validFrom, validTo, String(term.valid_from), term.valid_to ? String(term.valid_to) : null));
      if (overlap) throw new Error("Ten pracownik ma już warunki zatrudnienia obejmujące część wskazanego okresu. Zakończ poprzedni okres albo zmień daty.");
      const { data, error } = await db.from("employments").insert({
        workspace_id: workspace.id,
        employee_id: employeeId,
        employment_type: text(p.employmentType, "forma zatrudnienia", true),
        position: text(p.position, "stanowisko"),
        valid_from: validFrom,
        valid_to: validTo,
        full_time_equivalent: fte || null,
        monthly_cost: amount(p.monthlyCost, "koszt miesięczny") || null,
        hourly_cost: amount(p.hourlyCost, "koszt godzinowy") || null,
        currency: "PLN"
      }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie utworzono zatrudnienia.");
      id = data.id;
      await audit("employment", id, "created");
    } else if (body.action === "assignment_create") {
      const employeeId = await owned("employees", p.employeeId, "Pracownik");
      const projectId = await owned("projects", p.projectId, "Inwestycja");
      const dateFrom = date(p.dateFrom) ?? new Date().toISOString().slice(0, 10);
      const dateTo = date(p.dateTo);
      if (dateTo && dateFrom > dateTo) throw new Error("Początek przypisania nie może być po jego końcu.");
      const allocation = amount(p.allocationPercent, "zaangażowanie", true);
      if (allocation <= 0 || allocation > 100) throw new Error("Zaangażowanie musi mieścić się w zakresie 0–100%.");
      const { data: overlappingAssignments } = await db.from("assignments").select("date_from,date_to,allocation_percent").eq("workspace_id", workspace.id).eq("employee_id", employeeId);
      const existingLoad = (overlappingAssignments ?? []).filter((row) => periodsOverlap(dateFrom, dateTo, String(row.date_from ?? "1900-01-01"), row.date_to ? String(row.date_to) : null)).reduce((sum, row) => sum + Number(row.allocation_percent ?? 0), 0);
      const { data, error } = await db.from("assignments").insert({
        workspace_id: workspace.id,
        employee_id: employeeId,
        project_id: projectId,
        role: text(p.role, "rola", true),
        date_from: dateFrom,
        date_to: dateTo,
        allocation_percent: allocation
      }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie utworzono przypisania.");
      id = data.id;
      meta = { allocationWarning: existingLoad + allocation > 100 ? `Łączne obłożenie w nakładającym się okresie wynosi ${existingLoad + allocation}%.` : null };
      await audit("assignment", id, "created", null, { ...p, existingLoad, resultingLoad: existingLoad + allocation });
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
      const { data, error } = await db.rpc("issue_reservation_atomic", {
        p_workspace_id: workspace.id,
        p_reservation_id: reservationId,
        p_actor_id: user.id,
        p_movement_date: new Date().toISOString().slice(0, 10)
      }).single<{ result_movement_id: string; available_before: number; issued_quantity: number }>();
      if (error || !data) throw new Error(`Nie udało się atomowo wydać rezerwacji: ${error?.message ?? "brak danych"}`);
      id = data.result_movement_id;
      meta = { availableBefore: data.available_before, issuedQuantity: data.issued_quantity };
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
      const { data, error } = await db.rpc("transfer_stock_atomic", {
        p_workspace_id: workspace.id,
        p_project_id: projectId,
        p_source_warehouse_id: warehouseId,
        p_target_warehouse_id: targetWarehouseId,
        p_stock_item_id: stockItemId,
        p_quantity: quantity,
        p_document_number: text(p.documentNumber, "numer dokumentu") ?? "",
        p_movement_date: date(p.movementDate) ?? new Date().toISOString().slice(0, 10),
        p_actor_id: user.id
      }).single<{ result_movement_id: string; available_before: number }>();
      if (error || !data) throw new Error(`Nie udało się atomowo przesunąć materiału: ${error?.message ?? "brak danych"}`);
      id = data.result_movement_id;
      meta = { availableBefore: data.available_before };
    } else if (body.action === "vehicle_allocation_create") {
      const vehicleId = await owned("vehicles", p.vehicleId, "Pojazd");
      const projectId = p.projectId ? await owned("projects", p.projectId, "Inwestycja", true) : null;
      const employeeId = p.employeeId ? await owned("employees", p.employeeId, "Pracownik", true) : null;
      const dateFrom = date(p.dateFrom, true)!;
      const dateTo = date(p.dateTo);
      if (dateTo && dateFrom > dateTo) throw new Error("Koniec alokacji nie może poprzedzać początku.");
      if (!projectId && !employeeId) throw new Error("Wskaż inwestycję lub pracownika dla alokacji pojazdu.");
      const allocation = amount(p.allocationPercent, "alokacja");
      if (allocation < 0 || allocation > 100) throw new Error("Alokacja musi mieścić się w zakresie 0–100%.");
      const { data: existing } = await db.from("vehicle_allocations").select("date_from,date_to,allocation_percent").eq("workspace_id", workspace.id).eq("vehicle_id", vehicleId);
      const existingLoad = (existing ?? []).filter((row) => periodsOverlap(dateFrom, dateTo, String(row.date_from), row.date_to ? String(row.date_to) : null)).reduce((sum, row) => sum + Number(row.allocation_percent ?? 0), 0);
      const { data, error } = await db.from("vehicle_allocations").insert({
        workspace_id: workspace.id,
        vehicle_id: vehicleId,
        project_id: projectId,
        employee_id: employeeId,
        date_from: dateFrom,
        date_to: dateTo,
        allocation_method: text(p.allocationMethod, "metoda") ?? "time",
        allocation_percent: allocation || null
      }).select("id").single<{ id: string }>();
      if (error || !data) throw error ?? new Error("Nie utworzono alokacji pojazdu.");
      id = data.id;
      meta = { allocationWarning: allocation > 0 && existingLoad + allocation > 100 ? `Pojazd ma ${existingLoad + allocation}% nakładających się alokacji.` : null };
      await audit("vehicle_allocation", id, "created", null, { ...p, existingLoad, resultingLoad: existingLoad + allocation });
    } else if (body.action === "meter_reading_create") {
      const vehicleId = await owned("vehicles", p.vehicleId, "Pojazd");
      const readingDate = date(p.readingDate, true)!;
      const mileage = amount(p.mileage, "przebieg", true);
      const { data, error } = await db.rpc("record_meter_reading_atomic", {
        p_workspace_id: workspace.id,
        p_vehicle_id: vehicleId,
        p_reading_date: readingDate,
        p_mileage: mileage,
        p_actor_id: user.id
      }).single<{ result_id: string; previous_mileage: number; current_mileage: number }>();
      if (error || !data) throw new Error(`Nie udało się atomowo zapisać przebiegu: ${error?.message ?? "brak danych"}`);
      id = data.result_id;
      meta = { previousMileage: data.previous_mileage, currentMileage: data.current_mileage };
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
    return NextResponse.json({ ok: true, id, ...meta });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się wykonać operacji.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
