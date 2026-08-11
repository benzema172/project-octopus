import { notFound } from "next/navigation";
import { BrainPanel } from "@/components/brain/brain-panel";
import { DocumentUpload } from "@/components/documents/document-upload";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForProject } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { getAiRuntimeStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{
    projectId: string;
  }>;
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) {
    notFound();
  }

  const documents = await listDocumentsForProject(project.id);
  const aiStatus = getAiRuntimeStatus();

  return (
    <main className="workspace-page">
      <section className="page-heading project-heading">
        <div>
          <p className="eyebrow">Inwestycja</p>
          <h1>{project.name}</h1>
          <p>{[project.location, project.investor_name].filter(Boolean).join(" / ")}</p>
        </div>
        <span className="status-pill">{project.status}</span>
      </section>

      <section className="project-overview">
        <div>
          <span>Inwestor</span>
          <strong>{project.investor_name || "Nie uzupełniono"}</strong>
        </div>
        <div>
          <span>Generalny wykonawca</span>
          <strong>{project.general_contractor || "Nie uzupełniono"}</strong>
        </div>
        <div>
          <span>Dokumenty</span>
          <strong>{documents.length}</strong>
        </div>
      </section>

      <section className="section-band" id="documentation">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Dokumentacja</p>
            <h2>Pliki inwestycji</h2>
          </div>
        </div>
        <DocumentUpload projectId={project.id} documents={documents} />
      </section>

      <section className="section-band" id="brain">
        <BrainPanel status={aiStatus} compact />
      </section>
    </main>
  );
}
