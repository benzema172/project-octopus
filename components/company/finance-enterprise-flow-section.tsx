import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { FinanceEnterpriseFlow } from "@/components/company/finance-enterprise-flow";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getCompanyEnterpriseFlow } from "@/lib/data/enterprise-flow";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export async function FinanceEnterpriseFlowSection({ workspaceId }: { workspaceId: string }) {
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return null;
  const [canRead, canWrite, canApprove] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "read" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "approve" })
  ]);
  if (!canRead) return <DomainAccessDenied workspaceId={workspace.id} area="Finanse — obieg przedsiębiorstwa" />;
  const data = await getCompanyEnterpriseFlow(workspace.id);
  return <FinanceEnterpriseFlow workspaceId={workspace.id} data={data} canWrite={canWrite} canApprove={canApprove} />;
}
