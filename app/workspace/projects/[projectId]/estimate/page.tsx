import { ProjectModulePage } from "@/components/projects/project-module-page";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { PROJECT_MODULES } from "@/lib/product/project-modules";

export default async function EstimatePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectModulePage projectId={projectId} module={PROJECT_MODULES.estimate}><ProjectLiveRecords projectId={projectId} kind="estimate" /></ProjectModulePage>;
}
