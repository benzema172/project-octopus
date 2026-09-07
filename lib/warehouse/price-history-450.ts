export type WarehousePriceRow450 = Record<string, unknown>;

const sourcePriority = (row: WarehousePriceRow450) => {
  if (row.canonical_purchase === true) return 3;
  if (String(row.source_type ?? "") === "stock_movement_line") return 2;
  if (String(row.source_type ?? "") === "warehouse_ai_line") return 1;
  return 0;
};

const keyPart = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("pl");
const numeric = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function visibleWarehousePriceHistory450(rows: WarehousePriceRow450[]) {
  const sorted = [...rows].sort((a, b) => {
    const date = String(b.observed_at ?? b.created_at ?? "").localeCompare(String(a.observed_at ?? a.created_at ?? ""));
    if (date) return date;
    return sourcePriority(b) - sourcePriority(a);
  });

  const grouped = new Map<string, WarehousePriceRow450[]>();
  for (const row of sorted) {
    const invoiceNumber = keyPart(row.invoice_number);
    const key = [
      keyPart(row.stock_item_id ?? row.stockItemId),
      keyPart(row.counterparty_id),
      keyPart(row.observed_at ?? row.created_at),
      keyPart(row.unit_price_net),
      keyPart(row.unit),
      invoiceNumber || `bez-faktury:${keyPart(row.source_type)}:${keyPart(row.source_id ?? row.id)}`
    ].join("|");
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const events: WarehousePriceRow450[] = [];
  for (const eventRows of grouped.values()) {
    const highestPriority = Math.max(...eventRows.map(sourcePriority));
    const canonicalRows = eventRows.filter((row) => sourcePriority(row) === highestPriority);
    const representative = canonicalRows[0];
    const quantity = canonicalRows.reduce((sum, row) => sum + numeric(row.quantity), 0);
    events.push({
      ...representative,
      quantity,
      purchase_event_line_count: canonicalRows.length,
      purchase_event_source_count: eventRows.length
    });
  }

  return events.sort((a, b) => {
    const date = String(b.observed_at ?? b.created_at ?? "").localeCompare(String(a.observed_at ?? a.created_at ?? ""));
    if (date) return date;
    return sourcePriority(b) - sourcePriority(a);
  });
}

export function warehouseInvoiceLabel450(row: WarehousePriceRow450) {
  const value = String(row.invoice_number ?? "").trim();
  return value ? `FV ${value}` : "—";
}
