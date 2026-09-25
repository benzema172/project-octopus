"use client";

import { useEffect, useState } from "react";
import { WarehouseMarket410 } from "@/components/company/warehouse-market-410";
import { WarehouseMovementTruth531 } from "@/components/company/warehouse-movement-truth-531";
import { WarehousePriceAlertInspector490 } from "@/components/company/warehouse-price-alert-inspector-490";
import { WarehouseStockValueOverlay480 } from "@/components/company/warehouse-stock-value-overlay-480";
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

type WarehouseTab = "dashboard" | "stock" | "waiting" | "movements" | "needs" | "assets" | "counts" | "prices" | "locations";

function WarehouseEnhancements({
  workspaceId,
  data,
  canWrite,
  canApprove,
  warehouses,
  items,
  prices,
  counterparties,
  purchaseOrders,
  balances,
  costLayers,
  initialTab
}: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  warehouses: Row[];
  items: Row[];
  prices: Row[];
  counterparties: Row[];
  purchaseOrders: Row[];
  balances: Row[];
  costLayers: Row[];
  initialTab: WarehouseTab;
}) {
  const [activeTab, setActiveTab] = useState<WarehouseTab>(initialTab);

  useEffect(() => {
    const onTab = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: WarehouseTab }>).detail;
      if (detail?.tab) setActiveTab(detail.tab);
    };
    window.addEventListener("octopus:warehouse-tab", onTab);
    return () => window.removeEventListener("octopus:warehouse-tab", onTab);
  }, []);

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
    {activeTab === "movements" ? (
      <WarehouseMovementTruth531 workspaceId={workspaceId} data={data} canWrite={canWrite} canApprove={canApprove} />
    ) : null}
    {activeTab === "dashboard" ? (
      <WarehouseStockValueOverlay480 items={items} prices={prices} balances={balances} costLayers={costLayers} />
    ) : null}
    {activeTab === "prices" ? <>
      <WarehousePriceAlertInspector490 workspaceId={workspaceId} items={items} prices={prices} counterparties={counterparties} />
    </> : null}
  </>;
}

export default function WarehouseOperations({ workspaceId, data, canWrite, canApprove, query, tab }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
  tab?: string;
}) {
  const warehouses = (data.warehouses ?? []) as Row[];
  const items = ((data.catalogItems ?? data.items) ?? []) as Row[];
  const rawPrices = ((data.globalPriceObservations ?? data.priceObservations) ?? []) as Row[];
  const prices = visiblePrices(rawPrices);
  const counterparties = (data.counterparties ?? []) as Row[];
  const purchaseOrders = (data.warehousePurchaseOrders ?? []) as Row[];
  const balances = ((data.globalBalances ?? data.balances) ?? []) as Row[];
  const costLayers = (data.inventoryCostLayers ?? []) as Row[];
  const page = (data.page ?? {}) as Row;
  const initialTab = (["dashboard","stock","waiting","movements","needs","assets","counts","prices","locations"].includes(tab ?? "")
    ? tab
    : (query || Number(page.page ?? 1) > 1 ? "stock" : "dashboard")) as WarehouseTab;
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
    <WarehouseMarket410
      workspaceId={workspaceId}
      data={normalizedData}
      canWrite={canWrite}
      canApprove={canApprove}
      query={query}
      initialTab={initialTab}
    />
    <WarehouseEnhancements
      workspaceId={workspaceId}
      data={normalizedData}
      canWrite={canWrite}
      canApprove={canApprove}
      warehouses={warehouses}
      items={items}
      prices={prices}
      counterparties={counterparties}
      purchaseOrders={purchaseOrders}
      balances={balances}
      costLayers={costLayers}
      initialTab={initialTab}
    />
  </>;
}
