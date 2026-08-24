import { PackageSearch, Plus } from "lucide-react";
import { ProjectCompactModulePage } from "@/components/projects/project-compact-module-page";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { PROJECT_MODULES } from "@/lib/product/project-modules";

export default async function ProjectWarehousePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <ProjectCompactModulePage projectId={projectId} module={PROJECT_MODULES.warehouse} icon={PackageSearch} requiredDomain="warehouse">
      <details className="pw-submodule-tool"><summary><Plus size={17} aria-hidden="true" />Dodaj rezerwację materiału</summary><ProjectOperationPanel projectId={projectId} mode="reservation" /></details>
      <ProjectLiveRecords projectId={projectId} kind="warehouse" />
    </ProjectCompactModulePage>
  );
}
