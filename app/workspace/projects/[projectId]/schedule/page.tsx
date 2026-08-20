import { CalendarDays, FileText, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import "../../../../schedule-compact.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

export default async function SchedulePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area="Harmonogram" />;
  }

  const documents = await listDocumentsForCategories(projectId, ["harmonogram"]);

  return (
    <div className="project-tab-content pw-schedule-compact">
      <section className="pw-schedule-compact__hero">
        <div className="pw-schedule-compact__title">
          <span className="pw-schedule-compact__icon"><CalendarDays size={19} aria-hidden="true" /></span>
          <div>
            <p className="co-kicker">Harmonogram</p>
            <h2>Harmonogram inwestycji</h2>
            <p>Zadania, terminy i kolejność realizacji.</p>
          </div>
        </div>
        <span className="pw-schedule-compact__status">
          {documents.length ? `${documents.length} ${documents.length === 1 ? "plik źródłowy" : "pliki źródłowe"}` : "Brak pliku źródłowego"}
        </span>
      </section>

      <details id="schedule-add-task" className="pw-schedule-tool">
        <summary><Plus size={17} aria-hidden="true" />Dodaj zadanie harmonogramu</summary>
        <ProjectOperationPanel projectId={projectId} mode="schedule" />
      </details>

      <ProjectLiveRecords projectId={projectId} kind="schedule" />

      <details className="pw-schedule-sources">
        <summary><FileText size={16} aria-hidden="true" />Źródła harmonogramu <span>{documents.length}</span></summary>
        {documents.length ? (
          <div className="pw-schedule-sources__list">
            {documents.map((document) => (
              <div key={document.id}>
                <FileText size={15} aria-hidden="true" />
                <span><strong>{document.name}</strong><small>{document.category ?? "harmonogram"}</small></span>
              </div>
            ))}
          </div>
        ) : (
          <p>Brak przypisanych plików. Jeśli potrzebujesz, dodaj harmonogram przez Wrzutnię.</p>
        )}
      </details>
    </div>
  );
}
