import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { HrWorkspace147 } from "@/components/company/hr/hr-workspace-147";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getHrWorkspace140Data } from "@/lib/data/hr-workspace-140";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import styles from "./hr-employee-list-141.module.css";
import regression from "./hr-employee-list-1410.module.css";
import compact from "./hr-profile-compact-143.module.css";

export const dynamic = "force-dynamic";

export default async function HrPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();
  const canRead = await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "read" });
  if (!canRead) return <DomainAccessDenied workspaceId={workspace.id} area="Kadry" />;
  const referenceDate = new Date().toISOString().slice(0, 10);
  const [data, canWrite, canApprove] = await Promise.all([
    getHrWorkspace140Data(workspace.id, { referenceDate }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "hr", level: "approve" })
  ]);

  return <main className={`co-page ${styles.hr141} ${regression.hr1410} ${compact.profile143}`}>
    <header className="co-page-heading">
      <div>
        <p className="co-kicker">Kadry 2.0</p>
        <h1>Kadry i zasoby ludzkie</h1>
        <p>Pracownicy, brygady, inwestycje, czas pracy, urlopy, uprawnienia, BHP, dokumenty i koszt pracy w jednym miejscu.</p>
      </div>
    </header>
    <HrWorkspace147 workspaceId={workspace.id} data={data} canWrite={canWrite} canApprove={canApprove} />
  </main>;
}
