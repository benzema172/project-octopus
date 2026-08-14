import { ProjectModulePage } from "@/components/projects/project-module-page";
import { PROJECT_MODULES } from "@/lib/product/project-modules";

export default async function ProjectTeamPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectModulePage projectId={projectId} module={PROJECT_MODULES.team} />;
}
