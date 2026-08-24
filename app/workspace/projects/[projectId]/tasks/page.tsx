import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { ProjectTaskWorkspace } from "@/components/projects/project-task-workspace";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { listProjectTasks } from "@/lib/data/project-tasks";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export default async function ProjectTasksPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();

  const [canRead, canWrite] = await Promise.all([
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id }),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "write", projectId: project.id })
  ]);
  if (!canRead) return <DomainAccessDenied workspaceId={project.workspace_id} area="Plan działań inwestycji" />;

  const tasks = await listProjectTasks(project.workspace_id, project.id);
  const referenceTime = new Date().toISOString();
  return <ProjectTaskWorkspace key={referenceTime} projectId={project.id} initialTasks={tasks} canWrite={canWrite} referenceTime={referenceTime} />;
}
