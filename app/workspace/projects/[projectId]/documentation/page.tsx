import { notFound } from "next/navigation";
import { DocumentUpload } from "@/components/documents/document-upload";
import { ProjectDocumentControl } from "@/components/projects/project-document-control";
import { ServerPagination } from "@/components/system/server-pagination";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectDocumentOperations } from "@/lib/data/document-operations";
import { isDocumentStorageSchemaReady, listDocumentsForProjectPage } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";

export const dynamic = "force-dynamic";

type ProjectDocumentationPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ page?: string }>;
};

export default async function ProjectDocumentationPage({ params, searchParams }: ProjectDocumentationPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const page=Math.max(1,Number.parseInt(query.page??"1",10)||1);
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) return <DomainAccessDenied workspaceId={project.workspace_id} area="Dokumentacja inwestycji" />;

  const [documentsPage, trashPage, storageSchemaReady, operations, canWrite, canApprove, canAdminSettings] = await Promise.all([
    listDocumentsForProjectPage(project.id,{page,pageSize:50}),
    listDocumentsForProjectPage(project.id,{trashed:true,page:1,pageSize:25}),
    isDocumentStorageSchemaReady(),
    getProjectDocumentOperations(project.workspace_id, project.id),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "approve", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "settings", level: "admin" })
  ]);

  return (
    <div className="project-tab-content">
      <ProjectDocumentControl
        workspaceId={project.workspace_id}
        projectId={project.id}
        operations={operations}
        canWrite={canWrite}
        canApprove={canApprove}
        canGovern={canApprove && canAdminSettings}
      />
      <section className="section-band">
        <div className="section-heading">
          <div><p className="eyebrow">Wrzutnia</p><h2>Pliki inwestycji</h2></div>
          <p>{documentsPage.total} plików · strona {documentsPage.page}</p>
        </div>
        <DocumentUpload workspaceId={project.workspace_id} projectId={project.id} documents={documentsPage.items} trashedDocuments={trashPage.items} storageReady={storageSchemaReady}/>
        <ServerPagination page={documentsPage.page} pageSize={documentsPage.pageSize} total={documentsPage.total} pathname={`/workspace/projects/${project.id}/documentation`}/>
      </section>
    </div>
  );
}
