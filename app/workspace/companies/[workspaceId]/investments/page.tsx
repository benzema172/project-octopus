import { notFound } from "next/navigation";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import { ProjectCard } from "@/components/projects/project-card";
import { requireCurrentUser } from "@/lib/auth";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";

type CompanyInvestmentsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function CompanyInvestmentsPage({ params }: CompanyInvestmentsPageProps) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) {
    notFound();
  }

  const projects = await listProjectsForWorkspace(user, workspace.id);

  return (
    <main className="co-page">
      <header className="co-page-heading">
        <div>
          <p className="co-kicker">Inwestycje</p>
          <h1>Realizacje firmy</h1>
          <p>Centralny punkt wejścia do dokumentacji, danych i obsługi każdej inwestycji.</p>
        </div>
        <strong className="co-count-badge">{projects.length} inwestycji</strong>
      </header>

      <section className="co-section co-section--form">
        <div className="co-section-heading">
          <div>
            <p className="co-kicker">Nowa realizacja</p>
            <h2>Dodaj inwestycję</h2>
          </div>
        </div>
        <CreateProjectForm workspaceId={workspace.id} />
      </section>

      <section className="co-section">
        <div className="co-section-heading">
          <div>
            <p className="co-kicker">Portfel realizacji</p>
            <h2>Wszystkie inwestycje</h2>
          </div>
        </div>
        <div className="project-grid co-project-grid">
          {projects.length > 0 ? (
            projects.map((project) => <ProjectCard key={project.id} project={project} />)
          ) : (
            <div className="co-empty-state">
              <strong>Pierwsza inwestycja czeka na utworzenie.</strong>
              <p>Po dodaniu otrzyma własną kartę, dokumentację i kontekst OctopusAI.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
