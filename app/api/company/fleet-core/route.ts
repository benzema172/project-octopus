import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { JsonBodyError, readJsonBody } from "@/lib/http/json-body";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type Body = { workspaceId?: string; action?: string; payload?: Record<string, unknown> };

type Level = "write" | "approve";

const APPROVAL_ACTIONS = new Set(["ai_review_accept", "ai_review_ignore", "ai_undo", "anomaly_resolve"]);

function text(value: unknown, label: string, required = false) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new Error(`Uzupełnij pole: ${label}.`);
  return normalized || null;
}

function numberValue(value: unknown, label: string, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`Uzupełnij pole: ${label}.`);
    return null;
  }
  const parsed = parseLocalizedNumber(value);
  if (!Number.isFinite(parsed)) throw new Error(`Podaj prawidłową wartość: ${label}.`);
  return parsed;
}

function positive(value: unknown, label: string, required = false) {
  const parsed = numberValue(value, label, required);
  if (parsed !== null && parsed < 0) throw new Error(`${label} nie może być ujemne.`);
  return parsed;
}

function date(value: unknown) {
  const normalized = text(value, "data");
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function timestamp(value: unknown) {
  const normalized = text(value, "data i czas");
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function requireOwnedId(table: string, value: unknown, workspaceId: string, label: string) {
  const id = text(value, label, true)!;
  const { data, error } = await createServiceSupabaseClient().from(table).select("id").eq("workspace_id", workspaceId).eq("id", id).maybeSingle<{ id: string }>();
  if (error || !data) throw new Error(`${label} nie należy do aktywnej firmy.`);
  return id;
}

async function optionalOwnedId(table: string, value: unknown, workspaceId: string, label: string) {
  return value ? requireOwnedId(table, value, workspaceId, label) : null;
}

async function audit(workspaceId: string, userId: string, action: string, entityType: string, entityId: string, payload: Record<string, unknown>) {
  await createServiceSupabaseClient().from("audit_events").insert({
    workspace_id: workspaceId,
    actor_id: userId,
    event_type: `fleet.${action}`,
    entity_type: entityType,
    entity_id: entityId,
    after_value: payload
  });
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

  if (!body.workspaceId || !body.action || !body.payload) return NextResponse.json({ error: "Brakuje firmy, operacji lub danych." }, { status: 400 });
  const workspace = await getWorkspaceForUser(user, body.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  const requiredLevel: Level = APPROVAL_ACTIONS.has(body.action) ? "approve" : "write";
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "fleet", level: requiredLevel })) {
    return NextResponse.json({ error: requiredLevel === "approve" ? "Brak uprawnienia do zatwierdzania decyzji Floty." : "Brak uprawnienia do zapisu w module Flota." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const p = body.payload;

  try {
    let id: string | null = null;
    let eventId: string | null = null;

    if (body.action === "vehicle_create") {
      const registration = text(p.registrationNumber, "numer rejestracyjny", true)!.toUpperCase();
      const meterType = text(p.meterType, "rodzaj licznika") ?? "km";
      if (!["km", "hours", "both", "none"].includes(meterType)) throw new Error("Nieprawidłowy rodzaj licznika.");
      const responsibleEmployeeId = await optionalOwnedId("employees", p.responsibleEmployeeId, workspace.id, "Osoba odpowiedzialna");
      const defaultProjectId = await optionalOwnedId("projects", p.defaultProjectId, workspace.id, "Domyślna inwestycja");
      const { data, error } = await db.from("vehicles").insert({
        workspace_id: workspace.id,
        registration_number: registration,
        vin: text(p.vin, "VIN")?.toUpperCase() ?? null,
        vehicle_type: text(p.vehicleType, "typ pojazdu", true),
        make: text(p.make, "marka"),
        model: text(p.model, "model"),
        production_year: positive(p.productionYear, "rok produkcji"),
        ownership_type: text(p.ownershipType, "forma własności"),
        status: "active",
        current_mileage: positive(p.currentMileage, "przebieg"),
        meter_type: meterType,
        current_engine_hours: positive(p.currentEngineHours, "motogodziny"),
        fuel_type: text(p.fuelType, "rodzaj paliwa"),
        tank_capacity_l: positive(p.tankCapacityL, "pojemność zbiornika"),
        purchase_date: date(p.purchaseDate),
        purchase_price: positive(p.purchasePrice, "cena zakupu"),
        lease_end_date: date(p.leaseEndDate),
        responsible_employee_id: responsibleEmployeeId,
        default_project_id: defaultProjectId
      }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await audit(workspace.id, user.id, body.action, "vehicle", id, p);
    } else if (body.action === "vehicle_update") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const setText = (input: unknown, column: string, label: string, upper = false) => {
        if (input === undefined) return;
        const value = text(input, label);
        patch[column] = upper && value ? value.toUpperCase() : value;
      };
      setText(p.registrationNumber, "registration_number", "numer rejestracyjny", true);
      setText(p.vin, "vin", "VIN", true);
      setText(p.vehicleType, "vehicle_type", "typ pojazdu");
      setText(p.make, "make", "marka");
      setText(p.model, "model", "model");
      setText(p.ownershipType, "ownership_type", "forma własności");
      setText(p.fuelType, "fuel_type", "rodzaj paliwa");
      if (p.productionYear !== undefined) patch.production_year = positive(p.productionYear, "rok produkcji");
      if (p.tankCapacityL !== undefined) patch.tank_capacity_l = positive(p.tankCapacityL, "pojemność zbiornika");
      if (p.purchasePrice !== undefined) patch.purchase_price = positive(p.purchasePrice, "cena zakupu");
      if (p.purchaseDate !== undefined) patch.purchase_date = date(p.purchaseDate);
      if (p.leaseEndDate !== undefined) patch.lease_end_date = date(p.leaseEndDate);
      if (p.status !== undefined) {
        const status = text(p.status, "status", true)!;
        if (!["active", "inactive", "service", "sold"].includes(status)) throw new Error("Nieprawidłowy status pojazdu.");
        patch.status = status;
      }
      if (p.meterType !== undefined) {
        const meterType = text(p.meterType, "rodzaj licznika", true)!;
        if (!["km", "hours", "both", "none"].includes(meterType)) throw new Error("Nieprawidłowy rodzaj licznika.");
        patch.meter_type = meterType;
      }
      if (p.responsibleEmployeeId !== undefined) patch.responsible_employee_id = await optionalOwnedId("employees", p.responsibleEmployeeId, workspace.id, "Osoba odpowiedzialna");
      if (p.defaultProjectId !== undefined) patch.default_project_id = await optionalOwnedId("projects", p.defaultProjectId, workspace.id, "Domyślna inwestycja");
      const { error } = await db.from("vehicles").update(patch).eq("workspace_id", workspace.id).eq("id", vehicleId);
      if (error) throw error;
      id = vehicleId;
      await audit(workspace.id, user.id, body.action, "vehicle", id, p);
    } else if (body.action === "meter_reading") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { data, error } = await db.rpc("record_vehicle_meter_reading_300", {
        p_workspace_id: workspace.id,
        p_vehicle_id: vehicleId,
        p_reading_date: date(p.readingDate) ?? new Date().toISOString().slice(0, 10),
        p_mileage: positive(p.mileage, "przebieg"),
        p_engine_hours: positive(p.engineHours, "motogodziny"),
        p_source: text(p.source, "źródło") ?? "manual",
        p_source_document_id: null,
        p_source_fuel_entry_id: null,
        p_source_service_order_id: null,
        p_actor_id: user.id
      });
      if (error) throw new Error(`Nie udało się zapisać odczytu: ${error.message}`);
      id = String(data);
    } else if (body.action === "fuel_entry") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const employeeId = await optionalOwnedId("employees", p.employeeId, workspace.id, "Kierowca");
      const projectId = await optionalOwnedId("projects", p.projectId, workspace.id, "Inwestycja");
      const { data, error } = await db.rpc("record_fuel_entry_300_atomic", {
        p_workspace_id: workspace.id,
        p_vehicle_id: vehicleId,
        p_employee_id: employeeId,
        p_project_id: projectId,
        p_fueled_at: timestamp(p.fueledAt) ?? new Date().toISOString(),
        p_liters: positive(p.liters, "litry", true),
        p_gross_amount: positive(p.grossAmount, "kwota", true),
        p_mileage: positive(p.mileage, "przebieg"),
        p_fuel_type: text(p.fuelType, "rodzaj paliwa") ?? "",
        p_station_name: text(p.stationName, "stacja") ?? "",
        p_actor_id: user.id
      });
      if (error) throw new Error(`Nie udało się zapisać tankowania: ${error.message}`);
      id = String(data);
    } else if (body.action === "trip_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const employeeId = await optionalOwnedId("employees", p.employeeId, workspace.id, "Kierowca");
      const projectId = await optionalOwnedId("projects", p.projectId, workspace.id, "Inwestycja");
      const { data, error } = await db.from("trips").insert({
        workspace_id: workspace.id,
        vehicle_id: vehicleId,
        employee_id: employeeId,
        project_id: projectId,
        started_at: timestamp(p.startedAt) ?? new Date().toISOString(),
        finished_at: timestamp(p.finishedAt),
        start_location: text(p.startLocation, "miejsce startu"),
        end_location: text(p.endLocation, "miejsce docelowe"),
        distance_km: positive(p.distanceKm, "dystans", true),
        purpose: text(p.purpose, "cel przejazdu", true)
      }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await audit(workspace.id, user.id, body.action, "trip", id, p);
    } else if (body.action === "service_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const workshopCounterpartyId = await optionalOwnedId("counterparties", p.workshopCounterpartyId, workspace.id, "Warsztat");
      const { data, error } = await db.from("service_orders").insert({
        workspace_id: workspace.id,
        vehicle_id: vehicleId,
        service_type: text(p.serviceType, "rodzaj serwisu", true),
        opened_at: date(p.openedAt) ?? new Date().toISOString().slice(0, 10),
        next_due_date: date(p.nextDueDate),
        next_due_mileage: positive(p.nextDueMileage, "następny przebieg"),
        cost: positive(p.cost, "koszt"),
        status: "open",
        workshop_counterparty_id: workshopCounterpartyId,
        current_mileage: positive(p.currentMileage, "przebieg"),
        current_engine_hours: positive(p.currentEngineHours, "motogodziny"),
        notes: text(p.notes, "uwagi")
      }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await db.from("vehicles").update({ status: "service", updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", vehicleId);
      await audit(workspace.id, user.id, body.action, "service_order", id, p);
    } else if (body.action === "service_close") {
      const serviceId = await requireOwnedId("service_orders", p.serviceId, workspace.id, "Zlecenie serwisowe");
      const { data, error } = await db.rpc("close_service_order_300_atomic", {
        p_workspace_id: workspace.id,
        p_service_id: serviceId,
        p_closed_at: date(p.closedAt) ?? new Date().toISOString().slice(0, 10),
        p_cost: positive(p.cost, "koszt końcowy"),
        p_mileage: positive(p.mileage, "przebieg"),
        p_engine_hours: positive(p.engineHours, "motogodziny"),
        p_downtime_hours: positive(p.downtimeHours, "czas przestoju"),
        p_actor_id: user.id
      });
      if (error) throw new Error(`Nie udało się zamknąć serwisu: ${error.message}`);
      id = String(data);
      const { data: service } = await db.from("service_orders").select("vehicle_id").eq("workspace_id", workspace.id).eq("id", serviceId).single<{ vehicle_id: string }>();
      if (service?.vehicle_id) await db.from("vehicles").update({ status: "active", updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", service.vehicle_id).eq("status", "service");
    } else if (body.action === "service_plan_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      if (!p.intervalDays && !p.intervalKm && !p.intervalEngineHours && !p.nextDueDate && !p.nextDueMileage && !p.nextDueEngineHours) throw new Error("Podaj co najmniej jeden interwał lub następny termin serwisu.");
      const { data, error } = await db.from("vehicle_service_plans").insert({
        workspace_id: workspace.id,
        vehicle_id: vehicleId,
        name: text(p.name, "nazwa planu", true),
        service_type: text(p.serviceType, "rodzaj serwisu", true),
        interval_days: positive(p.intervalDays, "interwał dni"),
        interval_km: positive(p.intervalKm, "interwał km"),
        interval_engine_hours: positive(p.intervalEngineHours, "interwał motogodzin"),
        next_due_date: date(p.nextDueDate),
        next_due_mileage: positive(p.nextDueMileage, "następny przebieg"),
        next_due_engine_hours: positive(p.nextDueEngineHours, "następne motogodziny"),
        notes: text(p.notes, "uwagi")
      }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await audit(workspace.id, user.id, body.action, "vehicle_service_plan", id, p);
    } else if (body.action === "service_item_create") {
      const serviceOrderId = await requireOwnedId("service_orders", p.serviceOrderId, workspace.id, "Zlecenie serwisowe");
      const stockItemId = await optionalOwnedId("stock_items", p.stockItemId, workspace.id, "Część magazynowa");
      const { data, error } = await db.from("vehicle_service_items").insert({
        workspace_id: workspace.id,
        service_order_id: serviceOrderId,
        stock_item_id: stockItemId,
        item_type: text(p.itemType, "typ pozycji") ?? "labor",
        description: text(p.description, "opis pozycji", true),
        quantity: positive(p.quantity, "ilość", true) ?? 1,
        unit: text(p.unit, "jednostka"),
        unit_cost: positive(p.unitCost, "koszt jednostkowy")
      }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await audit(workspace.id, user.id, body.action, "vehicle_service_item", id, p);
    } else if (body.action === "document_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const amount = positive(p.amount, "kwota");
      const { data, error } = await db.from("vehicle_documents").insert({
        workspace_id: workspace.id,
        vehicle_id: vehicleId,
        document_type: text(p.documentType, "rodzaj dokumentu", true),
        number: text(p.number, "numer"),
        valid_from: date(p.validFrom),
        valid_until: date(p.validUntil),
        status: "valid",
        provider_name: text(p.providerName, "wystawca / ubezpieczyciel"),
        amount,
        currency: text(p.currency, "waluta") ?? "PLN",
        reminder_days: Math.max(0, Math.floor(positive(p.reminderDays, "wyprzedzenie przypomnienia") ?? 30))
      }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      if (amount && amount > 0) {
        await db.from("fleet_cost_links").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, cost_type: text(p.documentType, "rodzaj dokumentu") ?? "document", amount, currency: text(p.currency, "waluta") ?? "PLN", occurred_at: date(p.validFrom) ?? new Date().toISOString().slice(0, 10), source_type: "vehicle_document", source_id: id, notes: text(p.providerName, "wystawca") });
      }
      await audit(workspace.id, user.id, body.action, "vehicle_document", id, p);
    } else if (body.action === "component_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { data, error } = await db.from("vehicle_components").insert({
        workspace_id: workspace.id,
        vehicle_id: vehicleId,
        component_type: text(p.componentType, "typ komponentu", true),
        name: text(p.name, "nazwa", true),
        manufacturer: text(p.manufacturer, "producent"),
        model: text(p.model, "model"),
        serial_number: text(p.serialNumber, "numer seryjny"),
        dot_code: text(p.dotCode, "DOT"),
        installed_at: date(p.installedAt),
        installed_mileage: positive(p.installedMileage, "przebieg montażu"),
        installed_engine_hours: positive(p.installedEngineHours, "motogodziny montażu"),
        storage_location: text(p.storageLocation, "miejsce przechowywania"),
        condition: text(p.condition, "stan"),
        tread_depth_mm: positive(p.treadDepthMm, "głębokość bieżnika"),
        notes: text(p.notes, "uwagi")
      }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await audit(workspace.id, user.id, body.action, "vehicle_component", id, p);
    } else if (body.action === "component_remove") {
      const componentId = await requireOwnedId("vehicle_components", p.componentId, workspace.id, "Komponent");
      const { error } = await db.from("vehicle_components").update({ active: false, removed_at: date(p.removedAt) ?? new Date().toISOString().slice(0, 10), storage_location: text(p.storageLocation, "miejsce przechowywania"), condition: text(p.condition, "stan"), updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", componentId);
      if (error) throw error;
      id = componentId;
      await audit(workspace.id, user.id, body.action, "vehicle_component", id, p);
    } else if (body.action === "damage_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const employeeId = await optionalOwnedId("employees", p.employeeId, workspace.id, "Kierowca");
      const projectId = await optionalOwnedId("projects", p.projectId, workspace.id, "Inwestycja");
      const { data, error } = await db.from("damage_cases").insert({
        workspace_id: workspace.id,
        vehicle_id: vehicleId,
        employee_id: employeeId,
        project_id: projectId,
        occurred_at: timestamp(p.occurredAt) ?? new Date().toISOString(),
        description: text(p.description, "opis szkody", true),
        cost: positive(p.cost, "szacowany koszt"),
        status: "reported",
        location: text(p.location, "miejsce"),
        insurer: text(p.insurer, "ubezpieczyciel"),
        claim_number: text(p.claimNumber, "numer szkody"),
        deductible: positive(p.deductible, "udział własny"),
        liability_status: "undetermined"
      }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await audit(workspace.id, user.id, body.action, "damage_case", id, p);
    } else if (body.action === "damage_update") {
      const damageId = await requireOwnedId("damage_cases", p.damageId, workspace.id, "Szkoda");
      const patch: Record<string, unknown> = {};
      if (p.status !== undefined) patch.status = text(p.status, "status", true);
      if (p.claimNumber !== undefined) patch.claim_number = text(p.claimNumber, "numer szkody");
      if (p.insurer !== undefined) patch.insurer = text(p.insurer, "ubezpieczyciel");
      if (p.cost !== undefined) patch.cost = positive(p.cost, "koszt");
      if (p.deductible !== undefined) patch.deductible = positive(p.deductible, "udział własny");
      if (p.insurerPayout !== undefined) patch.insurer_payout = positive(p.insurerPayout, "wypłata ubezpieczyciela");
      if (p.liabilityStatus !== undefined) patch.liability_status = text(p.liabilityStatus, "odpowiedzialność");
      if (p.closedAt !== undefined) patch.closed_at = timestamp(p.closedAt);
      const repairServiceOrderId = p.repairServiceOrderId !== undefined ? await optionalOwnedId("service_orders", p.repairServiceOrderId, workspace.id, "Serwis naprawczy") : undefined;
      if (repairServiceOrderId !== undefined) patch.repair_service_order_id = repairServiceOrderId;
      const { error } = await db.from("damage_cases").update(patch).eq("workspace_id", workspace.id).eq("id", damageId);
      if (error) throw error;
      id = damageId;
      const { data: damage } = await db.from("damage_cases").select("vehicle_id,project_id,employee_id,cost,insurer_payout,status,occurred_at").eq("workspace_id", workspace.id).eq("id", damageId).single<{ vehicle_id: string; project_id: string | null; employee_id: string | null; cost: number | null; insurer_payout: number | null; status: string; occurred_at: string }>();
      if (damage?.status === "closed") {
        const actual = Math.max(0, Number(damage.cost ?? 0) - Number(damage.insurer_payout ?? 0));
        await db.from("fleet_cost_links").delete().eq("workspace_id", workspace.id).eq("source_type", "damage_case").eq("source_id", damageId);
        if (actual > 0) await db.from("fleet_cost_links").insert({ workspace_id: workspace.id, vehicle_id: damage.vehicle_id, project_id: damage.project_id, employee_id: damage.employee_id, damage_case_id: damageId, cost_type: "damage", amount: actual, currency: "PLN", occurred_at: damage.occurred_at.slice(0, 10), source_type: "damage_case", source_id: damageId, notes: "Koszt szkody po odjęciu wypłaty ubezpieczyciela" });
      }
      await audit(workspace.id, user.id, body.action, "damage_case", id, p);
    } else if (body.action === "allocation_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const employeeId = await optionalOwnedId("employees", p.employeeId, workspace.id, "Pracownik");
      const projectId = await optionalOwnedId("projects", p.projectId, workspace.id, "Inwestycja");
      if (!employeeId && !projectId) throw new Error("Wskaż pracownika lub inwestycję.");
      const allocationPercent = positive(p.allocationPercent, "udział") ?? 100;
      if (allocationPercent > 100) throw new Error("Udział przypisania nie może przekraczać 100%.");
      const { data, error } = await db.from("vehicle_allocations").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, employee_id: employeeId, project_id: projectId, date_from: date(p.dateFrom) ?? new Date().toISOString().slice(0, 10), date_to: date(p.dateTo), allocation_method: text(p.allocationMethod, "metoda") ?? "manual", allocation_percent: allocationPercent }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await audit(workspace.id, user.id, body.action, "vehicle_allocation", id, p);
    } else if (body.action === "cost_rate_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { data, error } = await db.from("vehicle_cost_rates").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, valid_from: date(p.validFrom) ?? new Date().toISOString().slice(0, 10), valid_to: date(p.validTo), cost_per_km: positive(p.costPerKm, "koszt / km", true), currency: text(p.currency, "waluta") ?? "PLN" }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await audit(workspace.id, user.id, body.action, "vehicle_cost_rate", id, p);
    } else if (body.action === "qualification_requirement_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { data, error } = await db.from("vehicle_required_qualifications").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, qualification_type: text(p.qualificationType, "rodzaj uprawnienia", true), notes: text(p.notes, "uwagi") }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      await audit(workspace.id, user.id, body.action, "vehicle_required_qualification", id, p);
    } else if (body.action === "vehicle_check_create") {
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const employeeId = await optionalOwnedId("employees", p.employeeId, workspace.id, "Operator");
      const status = text(p.status, "wynik", true) ?? "ok";
      if (!["ok", "attention", "blocked"].includes(status)) throw new Error("Nieprawidłowy wynik kontroli.");
      const checkedAt = timestamp(p.checkedAt) ?? new Date().toISOString();
      const mileage = positive(p.mileage, "przebieg");
      const engineHours = positive(p.engineHours, "motogodziny");
      const { data, error } = await db.from("vehicle_checks").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, employee_id: employeeId, checked_at: checkedAt, check_type: text(p.checkType, "rodzaj kontroli") ?? "daily", mileage, engine_hours: engineHours, status, notes: text(p.notes, "uwagi") }).select("id").single<{ id: string }>();
      if (error) throw error;
      id = data.id;
      if (mileage !== null || engineHours !== null) {
        const { error: readingError } = await db.rpc("record_vehicle_meter_reading_300", { p_workspace_id: workspace.id, p_vehicle_id: vehicleId, p_reading_date: checkedAt.slice(0, 10), p_mileage: mileage, p_engine_hours: engineHours, p_source: "vehicle_check", p_source_document_id: null, p_source_fuel_entry_id: null, p_source_service_order_id: null, p_actor_id: user.id });
        if (readingError) throw new Error(`Kontrola zapisana, ale odczyt licznika wymaga weryfikacji: ${readingError.message}`);
      }
      if (status === "blocked") {
        await db.from("fleet_anomalies").insert({ workspace_id: workspace.id, vehicle_id: vehicleId, anomaly_type: "vehicle_check_blocked", severity: "critical", title: "Pojazd zablokowany po kontroli", description: text(p.notes, "uwagi") ?? "Kontrola eksploatacyjna zakończona wynikiem blokującym.", source_type: "vehicle_check", source_id: id });
        await db.from("vehicles").update({ status: "inactive", updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", vehicleId);
      }
      await audit(workspace.id, user.id, body.action, "vehicle_check", id, p);
    } else if (body.action === "asset_assign") {
      const instanceId = await requireOwnedId("stock_item_instances", p.instanceId, workspace.id, "Sprzęt");
      const vehicleId = await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd");
      const { error } = await db.from("stock_item_instances").update({ vehicle_id: vehicleId, status: "assigned", updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", instanceId);
      if (error) throw error;
      id = instanceId;
      await audit(workspace.id, user.id, body.action, "stock_item_instance", id, p);
    } else if (body.action === "asset_unassign") {
      const instanceId = await requireOwnedId("stock_item_instances", p.instanceId, workspace.id, "Sprzęt");
      const { error } = await db.from("stock_item_instances").update({ vehicle_id: null, updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", instanceId);
      if (error) throw error;
      id = instanceId;
      await audit(workspace.id, user.id, body.action, "stock_item_instance", id, p);
    } else if (body.action === "anomaly_resolve") {
      const anomalyId = await requireOwnedId("fleet_anomalies", p.anomalyId, workspace.id, "Alert");
      const status = text(p.status, "status") ?? "resolved";
      if (!["acknowledged", "resolved", "ignored"].includes(status)) throw new Error("Nieprawidłowy status alertu.");
      const { error } = await db.from("fleet_anomalies").update({ status, resolved_by: user.id, resolved_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", anomalyId);
      if (error) throw error;
      id = anomalyId;
      await audit(workspace.id, user.id, body.action, "fleet_anomaly", id, p);
    } else if (body.action === "ai_review_accept" || body.action === "ai_review_ignore") {
      const reviewId = await requireOwnedId("fleet_document_reviews", p.reviewId, workspace.id, "Decyzja AI");
      const vehicleId = body.action === "ai_review_accept" ? await requireOwnedId("vehicles", p.vehicleId, workspace.id, "Pojazd") : null;
      const { data, error } = await db.rpc("resolve_fleet_review_300", { p_workspace_id: workspace.id, p_review_id: reviewId, p_vehicle_id: vehicleId, p_action: body.action === "ai_review_ignore" ? "ignore" : "accept", p_actor_id: user.id });
      if (error) throw new Error(`Nie udało się zastosować decyzji AI: ${error.message}`);
      eventId = String(data);
      id = reviewId;
    } else if (body.action === "ai_undo") {
      const eventIdInput = await requireOwnedId("fleet_ai_decision_events", p.eventId, workspace.id, "Decyzja AI");
      const { data, error } = await db.rpc("undo_fleet_ai_decision_300", { p_workspace_id: workspace.id, p_event_id: eventIdInput, p_actor_id: user.id });
      if (error) throw new Error(`Nie udało się cofnąć decyzji AI: ${error.message}`);
      id = String(data);
      eventId = eventIdInput;
    } else {
      return NextResponse.json({ error: "Nieobsługiwana operacja Floty." }, { status: 400 });
    }

    if (!id) throw new Error("Operacja nie zwróciła identyfikatora rekordu.");
    return NextResponse.json({ ok: true, id, eventId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operacja Floty nie powiodła się.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
