import type { ReactNode } from "react";
import { CompanyPowerTools } from "@/components/company/company-power-tools";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { getCompanyPowerToolsData, type CompanyPowerKind } from "@/lib/data/company-power-tools";
import { getWorkspaceForUser } from "@/lib/data/workspace";

const SECTION_KIND: Record<string, CompanyPowerKind | undefined> = {
  finances: "finance",
  hr: "hr",
  warehouse: "warehouse",
  fleet: "fleet",
  reports: "reports"
};

const KIND_DOMAIN: Record<CompanyPowerKind, Domain> = {
  finance: "finance",
  hr: "hr",
  warehouse: "warehouse",
  fleet: "fleet",
  reports: "reports"
};

async function loadPowerContext(workspaceId: string, kind: CompanyPowerKind) {
  try {
    const user = await requireCurrentUser();
    const workspace = await getWorkspaceForUser(user, workspaceId);
    if (!workspace) return null;
    const [canRead, canWrite] = await Promise.all([
      hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: KIND_DOMAIN[kind], level: "read" }),
      hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: KIND_DOMAIN[kind], level: "write" })
    ]);
    if (!canRead) return null;
    const data = await getCompanyPowerToolsData(workspace.id, kind);
    return { workspaceId: workspace.id, canWrite, data };
  } catch (error) {
    console.error("Project Octopus 0.8.0 power tools failed softly", error);
    return null;
  }
}

export default async function CompanySectionLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceId: string; section: string }> }) {
  const { workspaceId, section } = await params;
  const kind = SECTION_KIND[section];
  if (!kind) return children;
  const context = await loadPowerContext(workspaceId, kind);
  if (!context) return children;
  return <>{children}<CompanyPowerTools workspaceId={context.workspaceId} kind={kind} data={context.data as never} canWrite={context.canWrite} referenceDate={new Date().toISOString()} /></>;
}
