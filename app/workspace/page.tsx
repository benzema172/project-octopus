import { CreateProjectForm } from "@/components/projects/create-project-form";
import { ProjectCard } from "@/components/projects/project-card";
import { requireCurrentUser } from "@/lib/auth";
import { ensureWorkspaceForUser } from "@/lib/data/workspace";
import { listProjectsForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await requireCurrentUser();
  const workspace = await ensureWorkspaceForUser(user);
  const projects = await listProjectsForUser(user);

  return (
    <main className="workspace-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>Inwestycje</h1>
        </div>
        <p className="page-heading__meta">{projects.length} aktywnych pozycji</p>
      </section>

      <CreateProjectForm />

      <section className="project-grid" aria-label="Lista inwestycji">
        {projects.length > 0 ? (
          projects.map((project) => <ProjectCard key={project.id} project={project} />)
        ) : (
          <div className="empty-state">
            <h2>Pierwsza inwestycja czeka na utworzenie</h2>
            <p>Po dodaniu inwestycji pojawi się jej workspace, dokumentacja i panel Octopus Brain.</p>
          </div>
        )}
      </section>
    </main>
  );
}
