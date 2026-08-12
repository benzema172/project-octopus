import { notFound } from "next/navigation";
import { CompanyShell } from "@/components/layout/company-shell";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";

type ProjectLayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    projectId: string;
  }>;
};

const STATUS_LABELS: Record<string, string> = {
  planned: "Planowana",
  tender: "Przetarg",
  active: "Aktywna",
  paused: "Wstrzymana",
  completed: "Zakończona",
  archived: "Archiwalna"
};

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) {
    notFound();
  }

  const [profile, workspace] = await Promise.all([
    getProjectProfile(project),
    getWorkspaceForUser(user, project.workspace_id)
  ]);

  if (!workspace) {
    notFound();
  }

  const location = [profile.street, [profile.postalCode, profile.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return (
    <CompanyShell
      workspaceId={workspace.id}
      companyName={workspace.name}
      userEmail={user.email ?? "Project Octopus"}
    >
      <main className="workspace-page project-workspace co-project-workspace">
        <header className="project-shell-heading">
          <div>
            <p className="eyebrow">Inwestycja</p>
            <h1>{profile.projectName || project.name}</h1>
            <p>{location || profile.investorName || "Uzupełnij stałe dane inwestycji"}</p>
          </div>
          <span className="status-pill">{STATUS_LABELS[profile.status] ?? profile.status}</span>
        </header>

        <ProjectNavigation projectId={project.id} />
        {children}
      </main>
    </CompanyShell>
  );
}
