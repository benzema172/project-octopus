import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { UnifiedDocumentFlow } from "@/components/company/unified-document-flow";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getUnifiedDocumentFlow } from "@/lib/data/unified-document-flow";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export async function UnifiedDocumentFlowSection({ workspaceId }: { workspaceId: string }) {
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return null;
  const [canRead, canWrite, canApprove] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "read" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "approve" })
  ]);
  if (!canRead) return <DomainAccessDenied workspaceId={workspace.id} area="Finanse — wspólny obieg dokumentów" />;
  const data = await getUnifiedDocumentFlow(workspace.id);
  return <UnifiedDocumentFlow workspaceId={workspace.id} data={data} canWrite={canWrite} canApprove={canApprove} />;
}
