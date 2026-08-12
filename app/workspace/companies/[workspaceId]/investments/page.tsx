import { notFound } from "next/navigation";
import { CompanyInvestmentsView } from "@/components/projects/company-investments-view";
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

  return <CompanyInvestmentsView workspaceId={workspace.id} projects={projects} />;
}
