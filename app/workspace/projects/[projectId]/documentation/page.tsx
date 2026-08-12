import { notFound } from "next/navigation";
import { DocumentUpload } from "@/components/documents/document-upload";
import { requireCurrentUser } from "@/lib/auth";
import { isDocumentStorageSchemaReady, listDocumentsForProject } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

type ProjectDocumentationPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectDocumentationPage({ params }: ProjectDocumentationPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) {
    notFound();
  }

  const [documents, storageSchemaReady] = await Promise.all([
    listDocumentsForProject(project.id),
    isDocumentStorageSchemaReady()
  ]);

  return (
    <div className="project-tab-content">
      <section className="section-band">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Dokumentacja</p>
            <h2>Pliki inwestycji</h2>
          </div>
          <p>{documents.length} plików</p>
        </div>
        <DocumentUpload projectId={project.id} documents={documents} storageReady={storageSchemaReady} />
      </section>
    </div>
  );
}
