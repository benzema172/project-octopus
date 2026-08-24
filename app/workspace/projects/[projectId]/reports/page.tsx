import { FileBarChart2 } from "lucide-react";
import { ProjectCompactModulePage } from "@/components/projects/project-compact-module-page";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { PROJECT_MODULES } from "@/lib/product/project-modules";

export default async function ProjectReportsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <ProjectCompactModulePage projectId={projectId} module={PROJECT_MODULES.reports} icon={FileBarChart2} requiredDomain="reports">
      <ProjectLiveRecords projectId={projectId} kind="reports" />
    </ProjectCompactModulePage>
  );
}
