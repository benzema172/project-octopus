import { ProjectModulePage } from "@/components/projects/project-module-page";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { PROJECT_MODULES } from "@/lib/product/project-modules";

export default async function ProjectTeamPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectModulePage projectId={projectId} module={PROJECT_MODULES.team} requiredDomain="hr"><ProjectOperationPanel projectId={projectId} mode="assignment" /><ProjectLiveRecords projectId={projectId} kind="team" /></ProjectModulePage>;
}
