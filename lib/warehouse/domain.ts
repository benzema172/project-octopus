export const PHYSICAL_LINE_TYPES = new Set(["material", "equipment", "device", "tool", "spare_part", "consumable", ""]);

export function isPhysicalWarehouseLine(lineType: unknown) {
  return PHYSICAL_LINE_TYPES.has(String(lineType ?? "material").trim().toLowerCase());
}

export function inferWarehouseMovementType(direction: unknown, requestedType?: unknown): "PZ" | "WZ" {
  const requested = String(requestedType ?? "").trim().toUpperCase();
  if (requested === "PZ" || requested === "WZ") return requested;
  const normalized = String(direction ?? "").trim().toLowerCase();
  return new Set(["sale", "sales", "outgoing", "outbound", "issue"]).has(normalized) ? "WZ" : "PZ";
}

export function inventoryDifference(systemQuantity: unknown, countedQuantity: unknown) {
  const system = Number(systemQuantity ?? 0);
  const counted = Number(countedQuantity ?? 0);
  if (!Number.isFinite(system) || !Number.isFinite(counted) || counted < 0) throw new Error("Nieprawidłowy stan inwentaryzacji.");
  return counted - system;
}

export function priceChangePercent(currentPrice: unknown, previousPrice: unknown) {
  const current = Number(currentPrice ?? 0);
  const previous = Number(previousPrice ?? 0);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return 100 * (current - previous) / previous;
}

export function availableStock(balance: unknown, reserved: unknown) {
  const current = Number(balance ?? 0);
  const locked = Number(reserved ?? 0);
  if (!Number.isFinite(current) || !Number.isFinite(locked)) throw new Error("Nieprawidłowy stan lub rezerwacja.");
  return current - locked;
}

export function replenishmentQuantity(input: { balance: unknown; reserved: unknown; minimum: unknown; optimal: unknown }) {
  const available = availableStock(input.balance, input.reserved);
  const minimum = Math.max(0, Number(input.minimum ?? 0) || 0);
  const optimal = Math.max(0, Number(input.optimal ?? 0) || 0);
  const target = optimal > 0 ? Math.max(optimal, minimum) : minimum;
  return Math.max(0, target - available);
}

export function automationRate(autoLines: unknown, totalLines: unknown) {
  const automated = Math.max(0, Number(autoLines ?? 0) || 0);
  const total = Math.max(0, Number(totalLines ?? 0) || 0);
  if (!total) return 0;
  return Math.min(100, 100 * automated / total);
}
