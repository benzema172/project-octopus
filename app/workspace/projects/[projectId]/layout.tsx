import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
  params: Promise<{ projectId: string }>;
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

  if (!project) notFound();

  const [profile, workspace] = await Promise.all([
    getProjectProfile(project),
    getWorkspaceForUser(user, project.workspace_id)
  ]);

  if (!workspace) notFound();

  const location = [profile.street, [profile.postalCode, profile.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ") || project.location || "Do uzupełnienia";
  const shortName = profile.shortName || project.name;
  const fullName = profile.projectName || project.name;
  const contractNumber = profile.contractNumber || "Do uzupełnienia";

  return (
    <CompanyShell workspaceId={workspace.id} companyName={workspace.name} userEmail={user.email ?? "Project Octopus"}>
      <main className="workspace-page project-workspace co-project-workspace project-workspace-v2">
        <Link href={`/workspace/companies/${workspace.id}/investments`} className="pw-back-link">
          <ArrowLeft size={15} aria-hidden="true" />
          Wszystkie inwestycje
        </Link>

        <header className="pw-project-header pw-project-header--compact">
          <div className="pw-project-header__main">
            <div className="pw-project-title-row">
              <span className="pw-project-status">{STATUS_LABELS[profile.status] ?? profile.status}</span>
            </div>
            <h1>{shortName}</h1>
            <div className="pw-project-subtitle-line" aria-label="Podstawowe dane inwestycji">
              <strong>{fullName}</strong>
              <span>Kontrakt: {contractNumber}</span>
              <span>Lokalizacja: {location}</span>
            </div>
          </div>
        </header>

        <ProjectNavigation projectId={project.id} />
        {children}
      </main>
    </CompanyShell>
  );
}
