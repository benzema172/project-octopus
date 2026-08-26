import { notFound } from "next/navigation";
import { BrainPanel } from "@/components/brain/brain-panel";
import { BrainIntelligence130 } from "@/components/projects/brain-intelligence-130";
import { ProjectAiReviewCenter } from "@/components/projects/project-ai-review-center";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getBrainIntelligence130 } from "@/lib/data/project-intelligence-130";
import { getProjectKnowledgeSnapshot } from "@/lib/data/project-knowledge";
import { getProjectForUser } from "@/lib/data/projects";
import { getAiRuntimeStatus } from "@/lib/env";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectAiProposalReview } from "@/lib/data/project-ai-proposals";
import "../../../../brain-knowledge.css";
import "../../../../project-ai-review-center.css";

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

  const [reviewDocuments, knowledge, brain2, proposalReview, canWrite, canApprove] = await Promise.all([
    listDocumentsForCategories(projectId, ["other"]),
    getProjectKnowledgeSnapshot(projectId),
    getBrainIntelligence130(project.workspace_id, project.id),
    getProjectAiProposalReview(project.workspace_id, project.id),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "approve", projectId: project.id })
  ]);

  return (
    <div className="project-tab-content">
      <BrainPanel status={getAiRuntimeStatus()} reviewDocuments={reviewDocuments} knowledge={knowledge} />
      <BrainIntelligence130 latest={brain2.latest} conflicts={brain2.conflicts} history={brain2.history} provenance={brain2.provenance} />
      <ProjectAiReviewCenter projectId={project.id} review={proposalReview} canWrite={canWrite} canApprove={canApprove} compact/>
    </div>
  );
}
