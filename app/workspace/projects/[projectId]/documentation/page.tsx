import { notFound } from "next/navigation";
import { DocumentUpload } from "@/components/documents/document-upload";
import { requireCurrentUser } from "@/lib/auth";
import { isDocumentStorageSchemaReady, listDocumentsForProject } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { domainAccessPolicyAllows, domainForDocumentCategory, hasDomainAccess, loadDomainAccessPolicy } from "@/lib/authorization";
import { DOCUMENT_DESTINATIONS } from "@/lib/documents/classification";

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
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area="Dokumentacja inwestycji" />;
  }

  const [allDocuments, allTrashedDocuments, storageSchemaReady, accessPolicy] = await Promise.all([
    listDocumentsForProject(project.id),
    listDocumentsForProject(project.id, true),
    isDocumentStorageSchemaReady(),
    loadDomainAccessPolicy({ workspaceId: project.workspace_id, userId: user.id })
  ]);
  const canReadDocument = (document: { category: string | null }) => domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(document.category), level: "read", projectId: project.id });
  const documents = allDocuments.filter(canReadDocument);
  const trashedDocuments = allTrashedDocuments.filter(canReadDocument);
  const editableDocumentIds = [...documents, ...trashedDocuments].filter((document) => domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(document.category), level: "write", projectId: project.id })).map((document) => document.id);
  const allowedCategories = DOCUMENT_DESTINATIONS.filter((destination) => domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(destination.value), level: "write", projectId: project.id })).map((destination) => destination.value);

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
        <DocumentUpload
          workspaceId={project.workspace_id}
          projectId={project.id}
          documents={documents}
          trashedDocuments={trashedDocuments}
          storageReady={storageSchemaReady}
          canUpload={allowedCategories.length > 0}
          allowedCategories={allowedCategories}
          editableDocumentIds={editableDocumentIds}
        />
      </section>
    </div>
  );
}
