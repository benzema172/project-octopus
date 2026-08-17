import type { ReactNode } from "react";
import { AiQualityPanel } from "@/components/brain/ai-quality-panel";
import { requireCurrentUser } from "@/lib/auth";
import { domainAccessPolicyHasAnyScope, loadDomainAccessPolicy } from "@/lib/authorization";
import { getAiQualityMetrics } from "@/lib/data/ai-quality";
import { getWorkspaceForUser } from "@/lib/data/workspace";

async function loadAiQualityPanelData(workspaceId: string) {
  try {
    const user = await requireCurrentUser();
    const workspace = await getWorkspaceForUser(user, workspaceId);
    if (!workspace) return null;
    const policy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
    const canRead =
      domainAccessPolicyHasAnyScope(policy, { domain: "investments", level: "read" }) ||
      domainAccessPolicyHasAnyScope(policy, { domain: "reports", level: "read" }) ||
      domainAccessPolicyHasAnyScope(policy, { domain: "templates", level: "read" });
    if (!canRead) return null;
    return getAiQualityMetrics(workspace.id, 30);
  } catch (error) {
    console.error("Project Octopus AI quality panel failed softly", error);
    return null;
  }
}

export default async function AiCenterLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const metrics = await loadAiQualityPanelData(workspaceId);
  if (!metrics) return children;
  return <>{children}<main className="co-page co-page--continuation"><AiQualityPanel metrics={metrics} /></main></>;
}
