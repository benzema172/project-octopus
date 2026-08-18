import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import {
  AutopilotPanel,
  CommandCenterPanel,
  ExecutionPanel,
  ReconciliationPanel
} from "@/components/projects/control-isolated-panels";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { hasDomainAccess } from "@/lib/authorization";

export const dynamic = "force-dynamic";

function PanelLoading({ label }: { label: string }) {
  return <section className="execution-layer-notice" role="status"><div><strong>Ładowanie: {label}</strong><p>Ta część Kontroli 360 ładuje się niezależnie.</p></div></section>;
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

  return <div className="project-tab-content">
    <section className="project-module-heading"><div><p className="eyebrow">Kosztorys do odbioru</p><h2>Kontrola 360° inwestycji</h2><p>Jeden widok łączący zakres, wymagania, harmonogram, materiały, postęp, dowody, zmiany, cash flow i forecast. Każdy blok działa niezależnie — awaria jednego źródła nie blokuje pozostałych.</p></div></section>
    <Suspense fallback={<PanelLoading label="Command Center" />}><CommandCenterPanel workspaceId={project.workspace_id} projectId={project.id} canManageInvestments={canManageInvestments} /></Suspense>
    <Suspense fallback={<PanelLoading label="Investment Autopilot" />}><AutopilotPanel {...shared} /></Suspense>
    <Suspense fallback={<PanelLoading label="Reconciliation" />}><ReconciliationPanel {...shared} /></Suspense>
    <Suspense fallback={<PanelLoading label="Execution Layer" />}><ExecutionPanel {...shared} /></Suspense>
  </div>;
}
