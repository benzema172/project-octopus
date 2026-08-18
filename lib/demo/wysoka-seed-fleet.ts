import { asId, ensureRow, findOne, type Db, type SeedInput } from "@/lib/demo/wysoka-seed-shared";

export async function seedFleet(db: Db, input: SeedInput, employeeIds: Map<string, string>) {
  let created = 0;
  const vehicles = [
    ["PO TEST01", "Ford", "Transit", 2024, "van", 42180],
    ["PO TEST02", "Volkswagen", "Caddy", 2025, "van", 18320],
    ["PO TEST03", "Skoda", "Octavia", 2024, "passenger", 26750],
    ["PO TEST04", "Renault", "Master", 2023, "van", 68420],
    ["PO TEST05", "Toyota", "Proace", 2025, "van", 12440]
  ] as const;
  const ids = new Map<string, string>();
  for (const [registration, make, model, year, vehicleType, mileage] of vehicles) {
    const row = await ensureRow(db, "vehicles", { workspace_id: input.workspaceId, registration_number: registration }, {
      vin: `TESTVIN${registration.replaceAll(" ", "")}0001`, vehicle_type: vehicleType, make, model, production_year: year,
      ownership_type: registration === "PO TEST03" ? "leasing" : "company", status: "active", current_mileage: mileage
    });
    if (row.created) created += 1;
    ids.set(registration, asId(row.row));
  }

  const fuel = [
    ["PO TEST01", "2026-08-16T17:20:00+02:00", 63.2, 421.5, 42180, "TEST-002"],
    ["PO TEST02", "2026-08-15T15:10:00+02:00", 48.1, 322.3, 18320, "TEST-003"],
    ["PO TEST03", "2026-08-14T18:00:00+02:00", 44.7, 299.4, 26750, "TEST-001"],
    ["PO TEST04", "2026-08-12T16:40:00+02:00", 71.4, 478.7, 68420, "TEST-006"],
    ["PO TEST05", "2026-08-11T12:30:00+02:00", 51.5, 345.1, 12440, "TEST-009"]
  ] as const;
  for (const [registration, fueledAt, liters, grossAmount, mileage, employeeNumber] of fuel) {
    const vehicleId = ids.get(registration)!;
    const existing = await findOne(db, "fuel_entries", { workspace_id: input.workspaceId, vehicle_id: vehicleId, fueled_at: fueledAt });
    if (!existing) {
      const result = await db.from("fuel_entries").insert({
        workspace_id: input.workspaceId, vehicle_id: vehicleId, employee_id: employeeIds.get(employeeNumber) ?? null,
        project_id: input.projectId, fueled_at: fueledAt, liters, gross_amount: grossAmount, mileage
      });
      if (result.error) throw new Error(`Seed tankowania: ${result.error.message}`);
      created += 1;
    }
    const meter = await ensureRow(db, "meter_readings", { workspace_id: input.workspaceId, vehicle_id: vehicleId, reading_date: fueledAt.slice(0, 10), mileage }, { source: "demo_seed" });
    if (meter.created) created += 1;
  }

  for (const [registration, employeeNumber, startedAt, finishedAt, distanceKm, purpose] of [
    ["PO TEST01", "TEST-002", "2026-08-17T06:30:00+02:00", "2026-08-17T07:20:00+02:00", 46, "Dojazd brygady na inwestycję Wysoka"],
    ["PO TEST02", "TEST-003", "2026-08-17T15:40:00+02:00", "2026-08-17T16:20:00+02:00", 39, "Odbiór materiałów"],
    ["PO TEST03", "TEST-001", "2026-08-18T07:00:00+02:00", "2026-08-18T07:45:00+02:00", 42, "Nadzór inwestycji"],
    ["PO TEST04", "TEST-006", "2026-08-16T08:00:00+02:00", "2026-08-16T09:10:00+02:00", 58, "Transport narzędzi i spawarki"],
    ["PO TEST05", "TEST-009", "2026-08-15T09:00:00+02:00", "2026-08-15T10:05:00+02:00", 51, "Serwis urządzeń HVAC"]
  ] as const) {
    const vehicleId = ids.get(registration)!;
    const trip = await ensureRow(db, "trips", { workspace_id: input.workspaceId, vehicle_id: vehicleId, started_at: startedAt }, {
      employee_id: employeeIds.get(employeeNumber) ?? null, project_id: input.projectId, finished_at: finishedAt,
      start_location: "Baza firmy — TEST", end_location: "Wysoka — budowa TEST", distance_km: distanceKm, purpose
    });
    if (trip.created) created += 1;
    const allocation = await ensureRow(db, "vehicle_allocations", { workspace_id: input.workspaceId, vehicle_id: vehicleId, project_id: input.projectId, date_from: "2026-08-01" }, {
      employee_id: employeeIds.get(employeeNumber) ?? null, date_to: "2026-11-30", allocation_method: "time", allocation_percent: registration === "PO TEST03" ? 50 : 80
    });
    if (allocation.created) created += 1;
  }

  const serviceSpecs = [
    ["PO TEST01", "Przegląd okresowy", "2026-07-20", "2026-07-21", "2027-07-20", 55000, 1450, "closed"],
    ["PO TEST04", "Wymiana klocków hamulcowych", "2026-08-10", null, "2026-08-22", 70000, 980, "open"],
    ["PO TEST05", "Przegląd gwarancyjny", "2026-08-05", "2026-08-05", "2027-08-05", 30000, 0, "closed"]
  ] as const;
  for (const [registration, serviceType, openedAt, closedAt, nextDueDate, nextDueMileage, cost, status] of serviceSpecs) {
    const row = await ensureRow(db, "service_orders", { workspace_id: input.workspaceId, vehicle_id: ids.get(registration)!, service_type: serviceType, opened_at: openedAt }, {
      closed_at: closedAt, next_due_date: nextDueDate, next_due_mileage: nextDueMileage, cost, status
    });
    if (row.created) created += 1;
  }

  const damage = await ensureRow(db, "damage_cases", { workspace_id: input.workspaceId, vehicle_id: ids.get("PO TEST02")!, description: "[TEST] Zarysowanie prawego boku" }, {
    employee_id: employeeIds.get("TEST-003") ?? null, occurred_at: "2026-08-07T14:10:00+02:00", status: "open", cost: 1200, evidence: []
  });
  if (damage.created) created += 1;

  for (const [registration, documentType, number, validUntil] of [
    ["PO TEST01", "OC", "TEST-OC-01", "2027-02-15"], ["PO TEST01", "badanie_techniczne", "TEST-BT-01", "2027-01-20"],
    ["PO TEST02", "OC", "TEST-OC-02", "2027-03-10"], ["PO TEST04", "badanie_techniczne", "TEST-BT-04", "2026-09-15"]
  ] as const) {
    const row = await ensureRow(db, "vehicle_documents", { workspace_id: input.workspaceId, vehicle_id: ids.get(registration)!, document_type: documentType, number }, {
      valid_from: "2026-01-01", valid_until: validUntil, status: "valid"
    });
    if (row.created) created += 1;
  }

  return created;
}
