import { ProjectModulePage } from "@/components/projects/project-module-page";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { PROJECT_MODULES } from "@/lib/product/project-modules";

export default async function ProjectReportsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectModulePage projectId={projectId} module={PROJECT_MODULES.reports} requiredDomain="reports"><ProjectLiveRecords projectId={projectId} kind="reports" /></ProjectModulePage>;
}
