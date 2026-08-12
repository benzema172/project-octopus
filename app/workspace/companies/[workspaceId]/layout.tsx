import { notFound } from "next/navigation";
import { CompanyShell } from "@/components/layout/company-shell";
import { requireCurrentUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";

type CompanyLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
};

export default async function CompanyLayout({ children, params }: CompanyLayoutProps) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) {
    notFound();
  }

  return (
    <CompanyShell
      workspaceId={workspace.id}
      companyName={workspace.name}
      userEmail={user.email ?? "Project Octopus"}
    >
      {children}
    </CompanyShell>
  );
}
