import { asId, ensureRow, findOne, type Db, type SeedInput } from "@/lib/demo/wysoka-seed-shared";

export async function seedWarehouse(db: Db, input: SeedInput, boq: Map<string, string>, documentIds: Map<string, string>) {
  let created = 0;
  const warehouseSpecs = [
    ["Magazyn centralny — TEST", "Baza firmy", "central"],
    ["Magazyn Wysoka — TEST", "Wysoka / kontener M1", "site"],
    ["Magazyn narzędzi — TEST", "Baza firmy", "tools"]
  ] as const;
  const warehouses = new Map<string, string>();
  for (const [name, location, warehouseType] of warehouseSpecs) {
    const row = await ensureRow(db, "warehouses", { workspace_id: input.workspaceId, name }, { location, warehouse_type: warehouseType, active: true });
    if (row.created) created += 1;
    warehouses.set(name, asId(row.row));
  }
  const central = warehouses.get("Magazyn centralny — TEST")!;
  const site = warehouses.get("Magazyn Wysoka — TEST")!;

  const itemSpecs = [
    ["TEST-PP32", "Rura PP-R 32 PN20", "m", 80, 12.5],
    ["TEST-PVC110", "Rura PVC-U 110 SN8", "m", 60, 28],
    ["TEST-SPIRO250", "Kanał SPIRO Ø250", "m", 50, 44],
    ["TEST-IZO19", "Izolacja kauczukowa 19 mm", "m2", 40, 31],
    ["TEST-ZK32", "Zawór kulowy DN32", "szt.", 8, 84],
    ["TEST-PRZ250", "Przepustnica Ø250", "szt.", 6, 195],
    ["TEST-CU22", "Rura miedziana 22x1", "m", 50, 42],
    ["TEST-OT40", "Otulina mineralna 40 mm", "m", 60, 18],
    ["TEST-FILTR", "Filtr siatkowy DN32", "szt.", 4, 240],
    ["TEST-POMPA", "Pompa obiegowa test", "szt.", 1, 3200],
    ["TEST-WKR", "Wkręty i zawiesia wentylacyjne", "kpl.", 10, 165],
    ["TEST-TASMA", "Taśma aluminiowa HVAC", "szt.", 20, 32],
    ["TEST-MANO", "Manometr kontrolny WIKA — TEST", "szt.", 1, 680]
  ] as const;
  const items = new Map<string, string>();
  for (const [sku, name, unit, minimumStock] of itemSpecs) {
    const row = await ensureRow(db, "stock_items", { workspace_id: input.workspaceId, sku }, {
      name, item_type: "material", unit, minimum_stock: minimumStock, serial_tracking: false, active: true
    });
    if (row.created) created += 1;
    items.set(sku, asId(row.row));
  }

  const movementSpecs = [
    ["PZ", "PZ-TEST-001", central, null, "TEST-PP32", 300, 12.5, null],
    ["PZ", "PZ-TEST-002", central, null, "TEST-PVC110", 220, 28, null],
    ["PZ", "PZ-TEST-003", central, null, "TEST-SPIRO250", 180, 44, null],
    ["MM", "MM-TEST-001", central, site, "TEST-PP32", 180, 12.5, "TEST-001"],
    ["MM", "MM-TEST-002", central, site, "TEST-PVC110", 150, 28, "TEST-002"],
    ["MM", "MM-TEST-003", central, site, "TEST-SPIRO250", 120, 44, "TEST-005"],
    ["WZ", "WZ-TEST-004", site, null, "TEST-PP32", 120, 12.5, "TEST-001"],
    ["RW", "RW-TEST-002", site, null, "TEST-PVC110", 100, 28, "TEST-002"],
    ["RW", "RW-TEST-003", site, null, "TEST-SPIRO250", 62, 44, "TEST-005"],
    ["ZW", "ZW-TEST-001", site, null, "TEST-PP32", 10, 12.5, "TEST-001"]
  ] as const;
  for (const [movementType, documentNumber, warehouseId, targetWarehouseId, sku, quantity, unitCost, boqNumber] of movementSpecs) {
    const movement = await ensureRow(db, "stock_movements", { workspace_id: input.workspaceId, document_number: documentNumber }, {
      project_id: input.projectId, warehouse_id: warehouseId, target_warehouse_id: targetWarehouseId,
      movement_type: movementType, movement_date: "2026-08-17", status: "approved",
      source_document_id: documentNumber === "PZ-TEST-001" ? documentIds.get("[TEST] PZ-TEST-001 dostawa rur - Wysoka.txt") ?? null :
        documentNumber === "WZ-TEST-004" ? documentIds.get("[TEST] WZ-TEST-004 wydanie na montaz - Wysoka.txt") ?? null : null,
      approved_by: input.actorId, approved_at: "2026-08-17T14:00:00+02:00"
    });
    if (movement.created) created += 1;
    const line = await ensureRow(db, "stock_movement_lines", { workspace_id: input.workspaceId, movement_id: asId(movement.row), stock_item_id: items.get(sku)! }, {
      boq_item_id: boqNumber ? boq.get(boqNumber) ?? null : null, quantity, unit_cost: unitCost, lot_number: `LOT-${documentNumber}`
    });
    if (line.created) created += 1;
  }

  const reservations = [
    ["TEST-IZO19", 60, "2026-09-05"], ["TEST-PRZ250", 8, "2026-08-28"], ["TEST-CU22", 80, "2026-09-20"], ["TEST-POMPA", 1, "2026-09-10"]
  ] as const;
  for (const [sku, quantity, requiredAt] of reservations) {
    const row = await ensureRow(db, "reservations", { workspace_id: input.workspaceId, project_id: input.projectId, warehouse_id: central, stock_item_id: items.get(sku)! }, {
      quantity, required_at: requiredAt, status: "open"
    });
    if (row.created) created += 1;
  }

  const chainEvents = [
    ["ordered", "TEST-PP32", 300, 3750, "TEST-001"], ["received", "TEST-PP32", 300, 3750, "TEST-001"], ["issued", "TEST-PP32", 120, 1500, "TEST-001"],
    ["ordered", "TEST-SPIRO250", 180, 7920, "TEST-005"], ["received", "TEST-SPIRO250", 180, 7920, "TEST-005"], ["issued", "TEST-SPIRO250", 62, 2728, "TEST-005"]
  ] as const;
  for (const [stage, sku, quantity, amount, boqNumber] of chainEvents) {
    const sourceId = items.get(sku)!;
    const existing = await findOne(db, "material_chain_events", { workspace_id: input.workspaceId, project_id: input.projectId, stage, source_type: "demo_seed", source_id: sourceId, quantity });
    if (!existing) {
      const result = await db.from("material_chain_events").insert({
        workspace_id: input.workspaceId, project_id: input.projectId, boq_item_id: boq.get(boqNumber) ?? null,
        stock_item_id: sourceId, stage, source_type: "demo_seed", source_id: sourceId,
        quantity, unit: itemSpecs.find((item) => item[0] === sku)?.[2] ?? "szt.", amount, status: "confirmed",
        occurred_at: "2026-08-17T12:00:00+02:00", created_by: input.actorId
      });
      if (result.error) throw new Error(`Seed łańcucha materiałowego: ${result.error.message}`);
      created += 1;
    }
  }
  const inventory = await ensureRow(db, "inventory_counts", { workspace_id: input.workspaceId, warehouse_id: site, count_date: "2026-08-18" }, {
    status: "approved", snapshot: { demo: true, note: "Kontrolny spis testowy magazynu Wysoka" }, approved_by: input.actorId
  });
  if (inventory.created) created += 1;
  const toolId = items.get("TEST-MANO")!;
  const toolService = await ensureRow(db, "tool_service_events", { workspace_id: input.workspaceId, stock_item_id: toolId, event_type: "calibration", event_date: "2026-08-01" }, {
    next_due_date: "2027-08-01", cost: 180
  });
  if (toolService.created) created += 1;

  return { created, stockItems: items };
}
