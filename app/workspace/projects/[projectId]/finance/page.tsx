import { ProjectModulePage } from "@/components/projects/project-module-page";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { PROJECT_MODULES } from "@/lib/product/project-modules";

export default async function ProjectFinancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectModulePage projectId={projectId} module={PROJECT_MODULES.finance} requiredDomain="finance" kind="finance"><ProjectOperationPanel projectId={projectId} mode="budget" /><ProjectOperationPanel projectId={projectId} mode="change_order" /><ProjectLiveRecords projectId={projectId} kind="finance" /></ProjectModulePage>;
}
