import { notFound } from "next/navigation";
import { BrainPanel } from "@/components/brain/brain-panel";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectKnowledgeSnapshot } from "@/lib/data/project-knowledge";
import { getProjectForUser } from "@/lib/data/projects";
import { getAiRuntimeStatus } from "@/lib/env";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";

export const dynamic = "force-dynamic";

type ProjectBrainPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectBrainPage({ params }: ProjectBrainPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area="Brain inwestycji" />;
  }

  const [reviewDocuments, knowledge] = await Promise.all([
    listDocumentsForCategories(projectId, ["do_weryfikacji"]),
    getProjectKnowledgeSnapshot(projectId)
  ]);

  return (
    <div className="project-tab-content">
      <BrainPanel status={getAiRuntimeStatus()} reviewDocuments={reviewDocuments} knowledge={knowledge} />
    </div>
  );
}
