"use client";

import dynamic from "next/dynamic";
import type { Data } from "@/components/company/operations/module-shell";

const FinanceOperations = dynamic(() => import("@/components/company/operations/finance-operations"));
const HrOperations = dynamic(() => import("@/components/company/operations/hr-operations"));
const WarehouseOperations = dynamic(() => import("@/components/company/operations/warehouse-operations"));
const FleetOperations = dynamic(() => import("@/components/company/operations/fleet-operations"));
const ReportsOperations = dynamic(() => import("@/components/company/operations/reports-operations"));

type Kind = "finance" | "hr" | "warehouse" | "fleet" | "reports";

type Props = {
  workspaceId: string;
  kind: Kind;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  referenceDate: string;
};

export function CompanyOperationsWorkspace({ workspaceId, kind, data, canWrite, canApprove }: Props) {
  const pathname = `/workspace/companies/${workspaceId}/${kind === "finance" ? "finances" : kind}`;
  const common = { workspaceId, data, canWrite, canApprove, pathname, query: "" };

  if (kind === "finance") return <FinanceOperations {...common} />;
  if (kind === "hr") return <HrOperations {...common} />;
  if (kind === "warehouse") return <WarehouseOperations {...common} />;
  if (kind === "fleet") return <FleetOperations {...common} />;
  return <ReportsOperations {...common} />;
}
