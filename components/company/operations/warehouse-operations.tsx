"use client";

import { WarehouseMarket410 } from "@/components/company/warehouse-market-410";
import { WarehousePriceAlertInspector490 } from "@/components/company/warehouse-price-alert-inspector-490";
import { WarehouseUx440 } from "@/components/company/warehouse-ux-440";
import type { Data, Row } from "@/components/company/operations/module-shell";
import { visibleWarehousePriceHistory450 } from "@/lib/warehouse/price-history-450";

function visiblePrices(rows: Row[]) {
  const byItem = new Map<string, Row[]>();
  rows.forEach((row) => {
    const itemId = String(row.stock_item_id ?? row.stockItemId ?? "");
    if (!itemId) return;
    byItem.set(itemId, [...(byItem.get(itemId) ?? []), row]);
  });
  return [...byItem.values()].flatMap((history) => visibleWarehousePriceHistory450(history) as Row[]);
}

export default function WarehouseOperations({ workspaceId, data, canWrite, canApprove, query }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
}) {
  const warehouses = (data.warehouses ?? []) as Row[];
  const items = ((data.catalogItems ?? data.items) ?? []) as Row[];
  const rawPrices = ((data.globalPriceObservations ?? data.priceObservations) ?? []) as Row[];
  const prices = visiblePrices(rawPrices);
  const counterparties = (data.counterparties ?? []) as Row[];
  const purchaseOrders = (data.warehousePurchaseOrders ?? []) as Row[];
  const page = (data.page ?? {}) as Row;
  const initialTab = query || Number(page.page ?? 1) > 1 ? "stock" : "dashboard";
  const employees = ((data.employees ?? []) as Row[]).map((row) => ({
    ...row,
    name: `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`.trim() || String(row.employee_number ?? "Pracownik")
  }));
  const normalizedData: Data = {
    ...data,
    employees,
    globalPriceObservations: prices,
    priceObservations: prices
  };

  return <>
    <WarehouseUx440
      workspaceId={workspaceId}
      canWrite={canWrite}
      warehouses={warehouses}
      items={items}
      prices={prices}
      counterparties={counterparties}
      purchaseOrders={purchaseOrders}
      initialTab={initialTab}
    />
    <WarehousePriceAlertInspector490 items={items} prices={prices} counterparties={counterparties} />
    <WarehouseMarket410
      workspaceId={workspaceId}
      data={normalizedData}
      canWrite={canWrite}
      canApprove={canApprove}
      query={query}
    />
  </>;
}
