import { notFound } from "next/navigation";
import { InvestmentAutopilotCenter } from "@/components/projects/investment-autopilot-center";
import { ProjectExecutionCenter } from "@/components/projects/project-execution-center";
import { requireCurrentUser } from "@/lib/auth";
import { getInvestmentAutopilotSnapshot } from "@/lib/data/investment-autopilot";
import { getProjectExecutionSnapshot } from "@/lib/data/operations";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function ControlPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Kontrola 360°" />;
  const [canManageInvestments, financeAllowed, canManageFinance, warehouseAllowed] = await Promise.all([
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "read", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "warehouse", level: "read", projectId: project.id })
  ]);
  const [executionSnapshot, autopilotSnapshot] = await Promise.all([
    getProjectExecutionSnapshot(project.workspace_id, project.id, { includeFinance: financeAllowed, includeWarehouse: warehouseAllowed }),
    getInvestmentAutopilotSnapshot(project.workspace_id, project.id, { includeFinance: financeAllowed, includeWarehouse: warehouseAllowed })
  ]);
  return <div className="project-tab-content">
    <section className="project-module-heading"><div><p className="eyebrow">Kosztorys do odbioru</p><h2>Kontrola 360° inwestycji</h2><p>Jeden widok łączący zakres, wymagania, harmonogram, materiały, postęp, dowody, zmiany i forecast.</p></div></section>
    <InvestmentAutopilotCenter projectId={project.id} workspaceId={project.workspace_id} snapshot={autopilotSnapshot} canRun={canManageInvestments} financeAllowed={financeAllowed} warehouseAllowed={warehouseAllowed} />
    <ProjectExecutionCenter workspaceId={project.workspace_id} projectId={project.id} snapshot={executionSnapshot} financeAllowed={financeAllowed} canManageFinance={canManageFinance} warehouseAllowed={warehouseAllowed} canManageInvestments={canManageInvestments} />
  </div>;
}
