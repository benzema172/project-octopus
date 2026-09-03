"use client";

import { WarehouseWorkspace300 } from "@/components/company/warehouse-workspace-300";
import type { Data } from "@/components/company/operations/module-shell";

export default function WarehouseOperations({ workspaceId, data, canWrite, canApprove, query }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
}) {
  return <WarehouseWorkspace300
    workspaceId={workspaceId}
    data={data}
    canWrite={canWrite}
    canApprove={canApprove}
    query={query}
  />;
}
