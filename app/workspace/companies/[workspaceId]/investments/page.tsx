import { notFound } from "next/navigation";
import { CompanyInvestmentsView } from "@/components/projects/company-investments-view";
import { requireCurrentUser } from "@/lib/auth";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getProjectTaskSignals } from "@/lib/data/project-tasks";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { domainAccessPolicyAllows, domainAccessPolicyHasAnyScope, loadDomainAccessPolicy } from "@/lib/authorization";
import "../../../../investments-refinement.css";

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

  const policy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  if (!domainAccessPolicyHasAnyScope(policy, { domain: "investments", level: "read" })) {
    return <DomainAccessDenied workspaceId={workspace.id} area="Inwestycje" />;
  }
  const projects = (await listProjectsForWorkspace(user, workspace.id)).filter((project) =>
    domainAccessPolicyAllows(policy, { domain: "investments", level: "read", projectId: project.id })
  );
  const canCreate = domainAccessPolicyAllows(policy, { domain: "investments", level: "write", projectId: null });
  const taskSignals = await getProjectTaskSignals(workspace.id, projects.map((project) => project.id)).catch((error) => {
    console.error("Project Octopus: investment task signals unavailable", { workspaceId: workspace.id, message: error instanceof Error ? error.message : String(error) });
    return {};
  });

  return <CompanyInvestmentsView workspaceId={workspace.id} projects={projects} taskSignals={taskSignals} canCreate={canCreate} />;
}
