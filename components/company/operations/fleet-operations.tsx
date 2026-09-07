"use client";

import { FleetWorkspace300 } from "@/components/company/fleet-workspace-300";
import type { Data } from "@/components/company/operations/module-shell";

export default function FleetOperations({ workspaceId, data, canWrite, canApprove, query }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
}) {
  return <FleetWorkspace300 workspaceId={workspaceId} data={data} canWrite={canWrite} canApprove={canApprove} query={query} />;
}
