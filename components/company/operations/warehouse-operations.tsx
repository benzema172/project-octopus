"use client";

import { PackageCheck } from "lucide-react";
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
  const pendingMovements = (data.pendingDocumentMovements ?? []) as Row[];
  const pendingLines = (data.pendingDocumentMovementLines ?? []) as Row[];
  const warehouses = (data.warehouses ?? []) as Row[];
  const page = (data.page ?? {}) as Row;
  const initialTab = query || Number(page.page ?? 1) > 1 ? "stock" : "dashboard";
  const employees = ((data.employees ?? []) as Row[]).map((row) => ({
    ...row,
    name: `${String(row.first_name ?? "").trim()} ${String(row.last_name ?? "").trim()}`.trim() || String(row.employee_number ?? "Pracownik")
  }));
  const normalizedData: Data = { ...data, employees };

  return <>
    {pendingMovements.length ? <div role="note" style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9, padding: "8px 11px", border: "1px solid #cfe2d9", borderRadius: 11, background: "#f7fbf9", color: "#4e6259", fontSize: 10 }}>
      <PackageCheck size={15} style={{ color: "#267257", flex: "0 0 auto" }} />
      <span><strong style={{ color: "#285143" }}>Stan wg dokumentów jest już widoczny.</strong> Magazyn uwzględnia {pendingMovements.length} oczekujących szkiców PZ/WZ i {pendingLines.length} pozycji. Zatwierdzony stan fizyczny pozostaje oddzielny i zmieni się dopiero po akceptacji ruchu.</span>
    </div> : null}
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
