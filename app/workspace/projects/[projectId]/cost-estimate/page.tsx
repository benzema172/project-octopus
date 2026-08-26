import { FileText, History } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { BoqChangeControlWorkspace } from "@/components/projects/boq-change-control-workspace";
import { BoqRealityPanel130 } from "@/components/projects/boq-reality-panel-130";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectBoqControl } from "@/lib/data/project-boq-control";
import { getBoqReality130 } from "@/lib/data/project-intelligence-130";
import { getProjectForUser } from "@/lib/data/projects";
import "../../../../boq-compact.css";
import "../../../../boq-change-control.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function CostEstimatePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();

  const canRead = await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id });
  if (!canRead) return <DomainAccessDenied workspaceId={project.workspace_id} area="Kosztorys" />;

  const [documents, control, reality, canWrite, canApprove, canFinanceWrite, canFinanceApprove] = await Promise.all([
    listDocumentsForCategories(projectId, ["estimate"]),
    getProjectBoqControl(project.workspace_id, project.id),
    getBoqReality130(project.workspace_id, project.id),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "approve", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "approve", projectId: project.id })
  ]);

  return <div className="project-tab-content pw-boq-compact">
    <BoqChangeControlWorkspace
      projectId={project.id}
      versions={control.versions}
      versionItems={control.versionItems}
      currentItems={control.currentItems}
      wbsNodes={control.wbsNodes}
      changeOrders={control.changeOrders}
      versionDiffs={control.versionDiffs}
      permissions={{ write: canWrite, approve: canApprove, financeWrite: canFinanceWrite, financeApprove: canFinanceApprove }}
    />

    <BoqRealityPanel130 items={reality.reality} provenance={reality.provenance} />

    <details className="pw-boq-tool">
      <summary><History size={16} aria-hidden="true" />Importy i analiza kosztorysu</summary>
      <ProjectLiveRecords projectId={projectId} kind="estimate" />
    </details>

    <details className="pw-boq-tool">
      <summary><FileText size={16} aria-hidden="true" />Źródła kosztorysu <span>{documents.length}</span></summary>
      {documents.length ? <div className="pw-boq-sources">{documents.map((document) => <div key={document.id}><FileText size={15} aria-hidden="true" /><span><strong>{document.name}</strong><small>{document.category ?? "kosztorys"}</small></span></div>)}</div> : <p className="pw-boq-tool__empty">Brak przypisanych plików kosztorysowych.</p>}
    </details>
  </div>;
}
