import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { AccountingCenter } from "@/components/company/accounting-center";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getAccountingCenter } from "@/lib/data/accounting-center";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export async function AccountingCenterSection({workspaceId}:{workspaceId:string}) {
  const user=await requireCurrentUser();
  const workspace=await getWorkspaceForUser(user,workspaceId);
  if(!workspace) return null;
  const [canRead,canWrite,canApprove]=await Promise.all([
    hasDomainAccess({workspaceId,userId:user.id,domain:"finance",level:"read"}),
    hasDomainAccess({workspaceId,userId:user.id,domain:"finance",level:"write"}),
    hasDomainAccess({workspaceId,userId:user.id,domain:"finance",level:"approve"})
  ]);
  if(!canRead) return <DomainAccessDenied workspaceId={workspaceId} area="Finanse — Księgowość"/>;
  return <AccountingCenter workspaceId={workspaceId} data={await getAccountingCenter(workspaceId)} canWrite={canWrite} canApprove={canApprove}/>;
}
