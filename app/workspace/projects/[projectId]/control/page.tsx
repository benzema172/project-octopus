import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import {
  CommandCenterPanel,
  ExecutionPanel,
  ReconciliationPanel
} from "@/components/projects/control-isolated-panels";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { hasDomainAccess } from "@/lib/authorization";
import "../../../../control-360-compact.css";

export const dynamic = "force-dynamic";

function PanelLoading({ label }: { label: string }) {
  return <section className="control360-loading" role="status"><strong>Ładowanie: {label}</strong></section>;
}

export default async function ControlPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Kontrola 360°" />;

  const [canManageInvestments, financeAllowed, canManageFinance, warehouseAllowed, canManageWarehouse] = await Promise.all([
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "read", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "warehouse", level: "read", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "warehouse", level: "write", projectId: project.id })
  ]);

  const shared = { workspaceId: project.workspace_id, projectId: project.id, canManageInvestments, financeAllowed, canManageFinance, warehouseAllowed, canManageWarehouse };

  return <div className="project-tab-content control360-compact">
    <header className="control360-compact__header">
      <div><p className="co-kicker">Kontrola 360</p><h1>Stan i ryzyka inwestycji</h1></div>
      <span>Tylko dane potrzebne do decyzji</span>
    </header>

    <Suspense fallback={<PanelLoading label="stan inwestycji" />}><CommandCenterPanel workspaceId={project.workspace_id} projectId={project.id} canManageInvestments={canManageInvestments} /></Suspense>
    <Suspense fallback={<PanelLoading label="koszty i zgodność" />}><ReconciliationPanel {...shared} /></Suspense>
    <Suspense fallback={<PanelLoading label="kompletność realizacji" />}><ExecutionPanel {...shared} /></Suspense>
  </div>;
}
