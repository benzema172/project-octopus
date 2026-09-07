"use client";

import { WarehouseMarket410 } from "@/components/company/warehouse-market-410";
import { WarehouseUx440 } from "@/components/company/warehouse-ux-440";
import type { Data, Row } from "@/components/company/operations/module-shell";

export default function WarehouseOperations({ workspaceId, data, canWrite, canApprove, query }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
}) {
  const warehouses = (data.warehouses ?? []) as Row[];
  const page = (data.page ?? {}) as Row;
  const initialTab = query || Number(page.page ?? 1) > 1 ? "stock" : "dashboard";
  const employees = ((data.employees ?? []) as Row[]).map((row) => ({
    ...row,
    name: `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`.trim() || String(row.employee_number ?? "Pracownik")
  }));
  const normalizedData: Data = { ...data, employees };

  return <>
    <WarehouseUx440 workspaceId={workspaceId} canWrite={canWrite} warehouses={warehouses} initialTab={initialTab} />
    <WarehouseMarket410
      workspaceId={workspaceId}
      data={normalizedData}
      canWrite={canWrite}
      canApprove={canApprove}
      query={query}
    />
  </>;
}
