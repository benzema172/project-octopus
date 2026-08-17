export type PowerRow = Record<string, unknown>;

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function time(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function invoiceAging(invoices: PowerRow[], referenceDate: string) {
  const reference = time(referenceDate) ?? Date.now();
  const buckets = { overdue31Plus: 0, overdue8to30: 0, overdue1to7: 0, due14Days: 0, open: 0 };
  for (const invoice of invoices) {
    const open = Math.max(0, num(invoice.gross_amount) - num(invoice.paid_amount));
    if (!open) continue;
    buckets.open += open;
    const due = time(invoice.due_date);
    if (due === null) continue;
    const days = Math.floor((reference - due) / 86_400_000);
    if (days > 30) buckets.overdue31Plus += open;
    else if (days >= 8) buckets.overdue8to30 += open;
    else if (days >= 1) buckets.overdue1to7 += open;
    else if (days >= -14) buckets.due14Days += open;
  }
  return buckets;
}

export function employeeAllocationLoad(assignments: PowerRow[], referenceDate: string) {
  const reference = String(referenceDate).slice(0, 10);
  const load = new Map<string, number>();
  for (const assignment of assignments) {
    const from = String(assignment.date_from ?? "");
    const to = String(assignment.date_to ?? "");
    if (from && from > reference) continue;
    if (to && to < reference) continue;
    const employeeId = String(assignment.employee_id ?? "");
    if (!employeeId) continue;
    load.set(employeeId, (load.get(employeeId) ?? 0) + num(assignment.allocation_percent));
  }
  return load;
}

export function stockHealth(items: PowerRow[], balances: PowerRow[]) {
  const totalByItem = new Map<string, number>();
  for (const balance of balances) {
    const id = String(balance.stockItemId ?? balance.stock_item_id ?? "");
    if (!id) continue;
    totalByItem.set(id, (totalByItem.get(id) ?? 0) + num(balance.quantity));
  }
  return items.map((item) => {
    const id = String(item.id ?? "");
    const quantity = totalByItem.get(id) ?? 0;
    const minimum = Math.max(0, num(item.minimum_stock));
    return { id, quantity, minimum, shortage: Math.max(0, minimum - quantity), low: minimum > 0 && quantity < minimum };
  });
}

export function fleetEconomy(vehicles: PowerRow[], fuel: PowerRow[], trips: PowerRow[], service: PowerRow[], damages: PowerRow[]) {
  return vehicles.map((vehicle) => {
    const id = String(vehicle.id ?? "");
    const vehicleFuel = fuel.filter((row) => String(row.vehicle_id) === id);
    const distance = trips.filter((row) => String(row.vehicle_id) === id).reduce((sum, row) => sum + num(row.distance_km), 0);
    const liters = vehicleFuel.reduce((sum, row) => sum + num(row.liters), 0);
    const fuelCost = vehicleFuel.reduce((sum, row) => sum + num(row.gross_amount), 0);
    const serviceCost = service.filter((row) => String(row.vehicle_id) === id).reduce((sum, row) => sum + num(row.cost), 0);
    const damageCost = damages.filter((row) => String(row.vehicle_id) === id).reduce((sum, row) => sum + num(row.cost), 0);
    const totalCost = fuelCost + serviceCost + damageCost;
    return {
      id,
      distance,
      liters,
      fuelCost,
      totalCost,
      costPerKm: distance > 0 ? totalCost / distance : 0,
      litersPer100Km: distance > 0 ? liters / distance * 100 : 0
    };
  });
}
