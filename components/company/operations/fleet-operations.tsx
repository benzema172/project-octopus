"use client";

import { FleetWorkspace400 } from "@/components/company/fleet-workspace-400";
import type { Data } from "@/components/company/operations/module-shell";

export default function FleetOperations({ workspaceId, data, canWrite, canApprove, query }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
}) {
  return <FleetWorkspace400 workspaceId={workspaceId} data={data} canWrite={canWrite} canApprove={canApprove} query={query} />;
}
