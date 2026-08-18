import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Building2, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { CompanyShell } from "@/components/layout/company-shell";
import { ProjectAutopilotDock } from "@/components/projects/project-autopilot-dock";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getReliableInvestmentAutopilotSummary } from "@/lib/data/investment-autopilot-summary";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { domainAccessPolicyAllows, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import "../../../project-workspace-v2.css";
import "../../../project-dashboard-layout-refinement.css";
import "../../../project-intake.css";
import "../../../project-navigation-refinement.css";
import "../../../project-modules-operational.css";

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

async function loadAutopilotSummary(projectId: string) {
  try {
    return await getReliableInvestmentAutopilotSummary(projectId);
  } catch (error) {
    console.error("Investment Autopilot summary unavailable", error);
    return null;
  }
}

async function AutopilotDock({ projectId }: { projectId: string }) {
  const summary = await loadAutopilotSummary(projectId);
  return summary ? <ProjectAutopilotDock projectId={projectId} summary={summary} /> : null;
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();

  const [profile, workspace, policy] = await Promise.all([
    getProjectProfile(project.id),
    getWorkspaceForUser(user, project.workspace_id),
    loadDomainAccessPolicy(project.workspace_id, user.id)
  ]);
  if (!workspace) notFound();

  const can = (domain: Domain) => domainAccessPolicyAllows(policy, domain, "read", project.id);
  const projectStatus = STATUS_LABELS[String(project.status)] ?? String(project.status || "Aktywna");
  const internalName = profile.internalName || project.name;
  const contractName = profile.contractName || project.name;
  const contractNumber = profile.contractNumber || "—";
  const investor = profile.investor || project.investor_name || "—";
  const location = profile.location || project.location || "—";

  return (
    <CompanyShell workspace={workspace} user={user} activeProjectId={project.id}>
      <main className="project-workspace-v2">
        <header className="pw-project-header pw-project-header--contract">
          <div className="pw-project-header__identity">
            <Link href={`/workspace/companies/${workspace.id}/investments`} className="pw-back-link"><ArrowLeft size={15} /> Inwestycje</Link>
            <span className="pw-project-status">{projectStatus}</span>
            <h1>„{internalName}”</h1>
          </div>
          <div className="pw-project-contract">
            <strong>{contractName}</strong>
            <span>Numer kontraktu: {contractNumber}</span>
          </div>
          <div className="pw-project-meta pw-project-meta--header">
            <div><Building2 size={17} /><span><small>Inwestor</small><strong>{investor}</strong></span></div>
            <div><MapPin size={17} /><span><small>Lokalizacja</small><strong>{location}</strong></span></div>
          </div>
        </header>

        <ProjectNavigation projectId={project.id} access={{
          investments: can("investments"),
          finance: can("finance"),
          hr: can("hr"),
          warehouse: can("warehouse"),
          fleet: can("fleet")
        }} />
        {children}
        <Suspense fallback={null}><AutopilotDock projectId={project.id} /></Suspense>
      </main>
    </CompanyShell>
  );
}
