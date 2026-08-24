import { FileText, Plus, TrendingUp } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { ProjectCompactShell } from "@/components/projects/project-compact-module-page";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function ProgressPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area="Przerób" />;
  }
  const documents = await listDocumentsForCategories(projectId, ["estimate", "schedule", "protocol"]);

  return (
    <ProjectCompactShell
      icon={TrendingUp}
      kicker="Przerób"
      title="Postęp robót"
      description="Wykonane i odebrane ilości przeliczone według pozycji kosztorysowych."
      status={documents.length ? `${documents.length} źródeł` : "Brak źródeł"}
      metrics={[
        { label: "Źródła powiązań", value: String(documents.length), hint: "BOQ, plan i protokoły" },
        { label: "Model", value: "Ilość × cena", hint: "wartość z kosztorysu" },
        { label: "Przepływ", value: "4 etapy", hint: "plan → wykonanie → odbiór" }
      ]}
    >
      <details className="pw-submodule-tool">
        <summary><Plus size={17} aria-hidden="true" />Otwórz okres przerobowy</summary>
        <ProjectOperationPanel projectId={projectId} mode="progress_period" />
      </details>
      <details className="pw-submodule-tool">
        <summary><Plus size={17} aria-hidden="true" />Dodaj wykonanie pozycji BOQ</summary>
        <ProjectOperationPanel projectId={projectId} mode="progress_entry" />
      </details>

      <ProjectLiveRecords projectId={projectId} kind="progress" />

      <details className="pw-submodule-sources">
        <summary><FileText size={16} aria-hidden="true" />Źródła przerobu <span>{documents.length}</span></summary>
        {documents.length ? <div className="pw-submodule-sources__list">{documents.map((document) => <div key={document.id}><FileText size={15} aria-hidden="true" /><span><strong>{document.name}</strong><small>{document.category ?? "dokument"}</small></span></div>)}</div> : <p>Dodaj kosztorys, harmonogram lub protokół przez Wrzutnię.</p>}
      </details>
    </ProjectCompactShell>
  );
}
