import Link from "next/link";
import { ArrowLeft, Building2, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { CompanyShell } from "@/components/layout/company-shell";
import { ProjectAutopilotDock } from "@/components/projects/project-autopilot-dock";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getInvestmentAutopilotSummary } from "@/lib/data/investment-autopilot";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { domainAccessPolicyAllows, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";

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

  const [profile, workspace, autopilotSummary] = await Promise.all([
    getProjectProfile(project),
    getWorkspaceForUser(user, project.workspace_id),
    getInvestmentAutopilotSummary(project.id).catch(() => ({ attentionCount: 0, aiCanDoCount: 0, blockerCount: 0, healthScore: 100, nextTitle: null }))
  ]);

  if (!workspace) notFound();
  const policy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const domains: Domain[] = ["investments", "finance", "hr", "warehouse", "fleet", "templates", "reports", "settings"];
  const allowedProjectDomains = domains.filter((domain) => domainAccessPolicyAllows(policy, { domain, level: "read", projectId: project.id }));
  const allowedCompanyDomains = domains.filter((domain) => domainAccessPolicyAllows(policy, { domain, level: "read", projectId: null }));
  const canUpload = domainAccessPolicyAllows(policy, { domain: "investments", level: "write", projectId: project.id });

  const location = [profile.street, [profile.postalCode, profile.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ") || project.location || "Do uzupełnienia";
  const shortName = profile.shortName || project.name;
  const descriptionContractName = project.description
    ?.replace(/\s*Lokalizacja:.*$/i, "")
    .trim();
  const officialName =
    (profile.projectName && profile.projectName !== shortName ? profile.projectName : "") ||
    descriptionContractName ||
    profile.projectName ||
    project.name;
  const contractNumber = profile.contractNumber || "Do uzupełnienia";
  const investorName = profile.investorName || project.investor_name || "Do uzupełnienia";

  return (
    <CompanyShell workspaceId={workspace.id} companyName={workspace.name} userEmail={user.email ?? "Project Octopus"} allowedDomains={allowedCompanyDomains}>
      <main className="workspace-page project-workspace co-project-workspace project-workspace-v2">
        <Link href={`/workspace/companies/${workspace.id}/investments`} className="pw-back-link">
          <ArrowLeft size={15} aria-hidden="true" />
          Wszystkie inwestycje
        </Link>

        <header className="pw-project-header pw-project-header--contract">
          <div className="pw-project-header__identity">
            <span className="pw-project-status">{STATUS_LABELS[profile.status] ?? profile.status}</span>
            <h1>„{shortName}”</h1>
          </div>

          <div className="pw-project-contract" aria-label="Dane kontraktowe inwestycji">
            <strong>{officialName}</strong>
            <span>Numer kontraktu: {contractNumber}</span>
          </div>

          <div className="pw-project-meta pw-project-meta--header">
            <div>
              <Building2 size={16} aria-hidden="true" />
              <span><small>Inwestor</small><strong>{investorName}</strong></span>
            </div>
            <div>
              <MapPin size={16} aria-hidden="true" />
              <span><small>Lokalizacja</small><strong>{location}</strong></span>
            </div>
          </div>
        </header>

        <ProjectNavigation projectId={project.id} allowedDomains={allowedProjectDomains} canUpload={canUpload} />
        {allowedProjectDomains.includes("investments") ? <ProjectAutopilotDock projectId={project.id} summary={autopilotSummary} canRun={canUpload} /> : null}
        {children}
      </main>
    </CompanyShell>
  );
}
