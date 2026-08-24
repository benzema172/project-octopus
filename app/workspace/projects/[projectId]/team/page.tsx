import { Plus, UsersRound } from "lucide-react";
import { ProjectCompactModulePage } from "@/components/projects/project-compact-module-page";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { PROJECT_MODULES } from "@/lib/product/project-modules";

export default async function ProjectTeamPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <ProjectCompactModulePage projectId={projectId} module={PROJECT_MODULES.team} icon={UsersRound} requiredDomain="hr">
      <details className="pw-submodule-tool"><summary><Plus size={17} aria-hidden="true" />Przypisz osobę do inwestycji</summary><ProjectOperationPanel projectId={projectId} mode="assignment" /></details>
      <ProjectLiveRecords projectId={projectId} kind="team" />
    </ProjectCompactModulePage>
  );
}
