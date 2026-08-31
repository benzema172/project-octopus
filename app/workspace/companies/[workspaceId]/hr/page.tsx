import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { HrWorkspace149 } from "@/components/company/hr/hr-workspace-149";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getHrWorkspace140Data } from "@/lib/data/hr-workspace-140";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import styles from "./hr-employee-list-141.module.css";
import regression from "./hr-employee-list-1410.module.css";
import compact from "./hr-profile-compact-143.module.css";
import createModal from "./hr-employee-create-modal-151.module.css";

export const dynamic = "force-dynamic";

export default async function HrPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();
  const canRead = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "read" });
  if (!canRead) return <DomainAccessDenied workspaceId={workspace.id} area="Kadry" />;
  const referenceDate = new Date().toISOString().slice(0, 10);
  const [canWrite, canApprove, canFinanceRead, canFinanceWrite] = await Promise.all([
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "read" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "finance", level: "write" })
  ]);
  const canViewPayroll = canApprove || canFinanceRead;
  const canManagePayroll = canApprove || canFinanceWrite;
  const data = await getHrWorkspace140Data(workspace.id, { referenceDate, includePayroll: canViewPayroll });

  return <main className={`co-page ${styles.hr141} ${regression.hr1410} ${compact.profile143} ${createModal.create151}`}>
    <header className="co-page-heading">
      <div>
        <p className="co-kicker">Kadry 2.0</p>
        <h1>Kadry i zasoby ludzkie</h1>
        <p>Pracownicy, brygady, inwestycje, czas pracy, urlopy, uprawnienia, BHP, dokumenty i koszt pracy w jednym miejscu.</p>
      </div>
    </header>
    <HrWorkspace149
      workspaceId={workspace.id}
      data={data}
      canWrite={canWrite}
      canApprove={canApprove}
      canViewPayroll={canViewPayroll}
      canManagePayroll={canManagePayroll}
      companyCity={workspace.city}
    />
  </main>;
}
