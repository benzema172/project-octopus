import { notFound } from "next/navigation";
import { ProjectExecutionCenter } from "@/components/projects/project-execution-center";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectExecutionSnapshot } from "@/lib/data/operations";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export default async function ControlPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  const snapshot = await getProjectExecutionSnapshot(project.workspace_id, project.id);
  return <div className="project-tab-content"><section className="project-module-heading"><div><p className="eyebrow">Kosztorys do odbioru</p><h2>Kontrola 360° inwestycji</h2><p>Jeden widok łączący zakres, wymagania, harmonogram, materiały, postęp, dowody, zmiany i forecast.</p></div></section><ProjectExecutionCenter workspaceId={project.workspace_id} projectId={project.id} snapshot={snapshot} /></div>;
}
