"use client";

import { WarehouseMarket400 } from "@/components/company/warehouse-market-400";
import type { Data } from "@/components/company/operations/module-shell";

export default function WarehouseOperations({ workspaceId, data, canWrite, canApprove, query }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
}) {
  return <WarehouseMarket400
    workspaceId={workspaceId}
    data={data}
    canWrite={canWrite}
    canApprove={canApprove}
    query={query}
  />;
}
