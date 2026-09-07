export type WarehousePriceRow450 = Record<string, unknown>;

const sourcePriority = (row: WarehousePriceRow450) => {
  if (row.canonical_purchase === true) return 3;
  if (String(row.source_type ?? "") === "stock_movement_line") return 2;
  if (String(row.source_type ?? "") === "warehouse_ai_line") return 1;
  return 0;
};

const keyPart = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("pl");

export function visibleWarehousePriceHistory450(rows: WarehousePriceRow450[]) {
  const sorted = [...rows].sort((a, b) => {
    const date = String(b.observed_at ?? b.created_at ?? "").localeCompare(String(a.observed_at ?? a.created_at ?? ""));
    if (date) return date;
    return sourcePriority(b) - sourcePriority(a);
  });

  const bestByEvent = new Map<string, WarehousePriceRow450>();
  for (const row of sorted) {
    const invoiceNumber = keyPart(row.invoice_number);
    const key = [
      keyPart(row.stock_item_id ?? row.stockItemId),
      keyPart(row.counterparty_id),
      keyPart(row.observed_at ?? row.created_at),
      keyPart(row.unit_price_net),
      keyPart(row.quantity),
      keyPart(row.unit),
      invoiceNumber || "bez-faktury"
    ].join("|");
    const current = bestByEvent.get(key);
    if (!current || sourcePriority(row) > sourcePriority(current)) bestByEvent.set(key, row);
  }

  return [...bestByEvent.values()].sort((a, b) => {
    const date = String(b.observed_at ?? b.created_at ?? "").localeCompare(String(a.observed_at ?? a.created_at ?? ""));
    if (date) return date;
    return sourcePriority(b) - sourcePriority(a);
  });
}

export function warehouseInvoiceLabel450(row: WarehousePriceRow450) {
  const value = String(row.invoice_number ?? "").trim();
  return value ? `FV ${value}` : "—";
}
