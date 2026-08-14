import { notFound } from "next/navigation";
import { ProjectProfileForm } from "@/components/projects/project-profile-form";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";

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
      <ProjectProfileForm projectId={project.id} profile={profile} saved={query.saved === "1"} />
    </div>
  );
}
