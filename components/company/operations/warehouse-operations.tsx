"use client";

import { WarehouseMarket410 } from "@/components/company/warehouse-market-410";
import type { Data } from "@/components/company/operations/module-shell";

export default function WarehouseOperations({ workspaceId, data, canWrite, canApprove, query }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
}) {
  return <WarehouseMarket410
    workspaceId={workspaceId}
    data={data}
    canWrite={canWrite}
    canApprove={canApprove}
    query={query}
  />;
}
