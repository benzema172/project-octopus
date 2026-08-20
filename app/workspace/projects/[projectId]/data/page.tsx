import { ShieldCheck, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectProfileForm } from "@/components/projects/project-profile-form";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import "../../../../project-profile-ai.css";

export const dynamic = "force-dynamic";

type ProjectDataPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export default async function ProjectDataPage({ params, searchParams }: ProjectDataPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) notFound();

  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area="Dane inwestycji" />;
  }

  const profile = await getProjectProfile(project);

  return (
    <div className="project-tab-content pw-data-page">
      <aside className="project-profile-ai-note" aria-label="Automatyczne uzupełnianie Karty inwestycji">
        <span className="project-profile-ai-note__icon"><Sparkles size={18} aria-hidden="true" /></span>
        <span className="project-profile-ai-note__copy">
          <strong>Karta hybrydowa: ręcznie + OctopusAI</strong>
          <span>Możesz wpisać dane samodzielnie. Po analizie plików z Wrzutni AI automatycznie uzupełnia rozpoznane pola Karty inwestycji na podstawie umów, dokumentacji, decyzji i danych projektowych.</span>
        </span>
        <span className="project-profile-ai-note__rule"><ShieldCheck size={14} aria-hidden="true" /> Ręczne dane mają pierwszeństwo</span>
      </aside>
      <ProjectProfileForm projectId={project.id} profile={profile} saved={query.saved === "1"} />
    </div>
  );
}
