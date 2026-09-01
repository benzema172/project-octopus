export const PHYSICAL_LINE_TYPES = new Set(["material", "equipment", "device", "tool", ""]);

export function isPhysicalWarehouseLine(lineType: unknown) {
  return PHYSICAL_LINE_TYPES.has(String(lineType ?? "material").trim().toLowerCase());
}

export function inferWarehouseMovementType(direction: unknown, requestedType?: unknown): "PZ" | "WZ" {
  const requested = String(requestedType ?? "").trim().toUpperCase();
  if (requested === "PZ" || requested === "WZ") return requested;
  return String(direction ?? "").trim().toLowerCase() === "sale" ? "WZ" : "PZ";
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
