import { notFound } from "next/navigation";
import { BrainKnowledge } from "@/components/brain/brain-knowledge";
import { BrainPanel } from "@/components/brain/brain-panel";
import { requireCurrentUser } from "@/lib/auth";
import { getBrainKnowledge } from "@/lib/data/brain-knowledge";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getProjectForUser } from "@/lib/data/projects";
import { getAiRuntimeStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

type ProjectBrainPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectBrainPage({ params }: ProjectBrainPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) notFound();

  const [reviewDocuments, knowledge] = await Promise.all([
    listDocumentsForCategories(projectId, ["do_weryfikacji"]),
    getBrainKnowledge(projectId)
  ]);

  return (
    <div className="project-tab-content brain-project-page">
      <BrainPanel status={getAiRuntimeStatus()} reviewDocuments={reviewDocuments} />
      <BrainKnowledge knowledge={knowledge} />
    </div>
  );
}
