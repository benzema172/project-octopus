import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { FinanceControlTower } from "@/components/company/finance-control-tower";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getFinanceControlTower } from "@/lib/data/finance-control-tower";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export async function FinanceControlTowerSection({ workspaceId, initialTab }: { workspaceId: string; initialTab?: string }) {
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return null;
  const [canRead, canWrite, canApprove] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "read" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "approve" })
  ]);
  if (!canRead) return <DomainAccessDenied workspaceId={workspace.id} area="Finanse — Finance Control Tower" />;
  const data = await getFinanceControlTower(workspace.id);
  return <FinanceControlTower workspaceId={workspace.id} data={data} canWrite={canWrite} canApprove={canApprove} initialTab={initialTab} />;
}
