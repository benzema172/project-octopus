import { notFound } from "next/navigation";
import { BrainPanel } from "@/components/brain/brain-panel";
import { requireCurrentUser } from "@/lib/auth";
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

  if (!project) {
    notFound();
  }

  return (
    <div className="project-tab-content">
      <BrainPanel status={getAiRuntimeStatus()} />
    </div>
  );
}
