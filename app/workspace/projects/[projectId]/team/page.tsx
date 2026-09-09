import { Plus, UsersRound } from "lucide-react";
import { ProjectCompactModulePage } from "@/components/projects/project-compact-module-page";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { ProjectTeamWorklog570 } from "@/components/projects/project-team-worklog-570";
import { PROJECT_MODULES } from "@/lib/product/project-modules";

type ProjectTeamPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ month?: string | string[] }>;
};

export default async function ProjectTeamPage({ params, searchParams }: ProjectTeamPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const selectedMonth = Array.isArray(query.month) ? query.month[0] : query.month;

  return (
    <ProjectCompactModulePage
      projectId={projectId}
      module={PROJECT_MODULES.team}
      icon={UsersRound}
      requiredDomain="hr"
      statusLabel="Ewidencja z Kadr"
    >
      <details className="pw-submodule-tool"><summary><Plus size={17} aria-hidden="true" />Przypisz osobę do inwestycji</summary><ProjectOperationPanel projectId={projectId} mode="assignment" /></details>
      <ProjectTeamWorklog570 projectId={projectId} selectedMonth={selectedMonth} />
    </ProjectCompactModulePage>
  );
}
