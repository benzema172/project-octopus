import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Building2, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { CompanyShell } from "@/components/layout/company-shell";
import { ProjectAutopilotDock } from "@/components/projects/project-autopilot-dock";
import { ProjectAutopilotRouteGate } from "@/components/projects/project-autopilot-route-gate";
import { ProjectIntakeSlot } from "@/components/projects/project-intake-slot";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getReliableInvestmentAutopilotSummary } from "@/lib/data/investment-autopilot-summary";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { domainAccessPolicyAllows, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import "../../../project-workspace-v2.css";
import "../../../project-intake.css";
import "../../../project-navigation-refinement.css";
import "../../../project-modules-operational.css";
import "../../../layout-density-project-audit.css";
import "../../../investment-ux-repair.css";
import "../../../investment-content-refinement.css";
import "../../../investment-card-typography.css";
import "../../../investment-menu-toggle-fix.css";
import "../../../wrzutnia-mascot-refinement.css";
import "../../../project-submodules-compact.css";
import "../../../project-section-rhythm-final.css";
import "../../../project-actions.css";

export const dynamic = "force-dynamic";
type ProjectLayoutProps = { children: React.ReactNode; params: Promise<{ projectId: string }> };

const STATUS_LABELS: Record<string, string> = { planned: "Planowana", tender: "Przetarg", active: "Aktywna", paused: "Wstrzymana", completed: "Zakończona", archived: "Archiwalna" };

async function loadAutopilotSummary(projectId: string) {
  try { return await getReliableInvestmentAutopilotSummary(projectId); }
  catch (error) {
    console.error("Project Octopus: project Autopilot summary unavailable", { projectId, message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function AsyncProjectAutopilotDock({ projectId, canRun }: { projectId: string; canRun: boolean }) {
  const summary = await loadAutopilotSummary(projectId);
  return summary ? <ProjectAutopilotDock projectId={projectId} summary={summary} canRun={canRun} /> : null;
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();

  const [profile, workspace, policy] = await Promise.all([
    getProjectProfile(project),
    getWorkspaceForUser(user, project.workspace_id),
    loadDomainAccessPolicy({ workspaceId: project.workspace_id, userId: user.id })
  ]);
  if (!workspace) notFound();

  const domains: Domain[] = ["investments", "finance", "hr", "warehouse", "fleet", "templates", "reports", "settings"];
  const allowedProjectDomains = domains.filter((domain) => domainAccessPolicyAllows(policy, { domain, level: "read", projectId: project.id }));
  const allowedCompanyDomains = domains.filter((domain) => domainAccessPolicyAllows(policy, { domain, level: "read", projectId: null }));
  const canUpload = domainAccessPolicyAllows(policy, { domain: "investments", level: "write", projectId: project.id });

  const location = [profile.street, [profile.postalCode, profile.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || project.location || "Do uzupełnienia";
  const shortName = profile.shortName || project.name;
  const descriptionContractName = project.description?.replace(/\s*Lokalizacja:.*$/i, "").trim();
  const officialName = (profile.projectName && profile.projectName !== shortName ? profile.projectName : "") || descriptionContractName || profile.projectName || project.name;
  const contractNumber = profile.contractNumber || "Do uzupełnienia";
  const investorName = profile.investorName || project.investor_name || "Do uzupełnienia";

  return (
    <CompanyShell workspaceId={workspace.id} companyName={workspace.name} userEmail={user.email ?? "Project Octopus"} allowedDomains={allowedCompanyDomains}>
      <main className="workspace-page project-workspace co-project-workspace project-workspace-v2">
        <section className="pw-project-top-shell" aria-label="Nagłówek i nawigacja inwestycji">
          <header className="pw-project-header pw-project-header--contract pw-project-header--compact pw-project-header--with-intake">
            <div className="pw-project-header__identity">
              <Link href={`/workspace/companies/${workspace.id}/investments`} className="pw-project-header__back" aria-label="Wszystkie inwestycje" title="Wszystkie inwestycje"><ArrowLeft size={15} aria-hidden="true" /></Link>
              <div><span className="pw-project-status">{STATUS_LABELS[profile.status] ?? profile.status}</span><h1>„{shortName}”</h1></div>
            </div>

            <div className="pw-project-contract" aria-label="Dane kontraktowe inwestycji">
              <strong title={officialName}>{officialName}</strong>
              <span>Numer kontraktu: {contractNumber}</span>
            </div>

            <div className="pw-project-meta pw-project-meta--header">
              <div><Building2 size={16} aria-hidden="true" /><span><small>Inwestor</small><strong title={investorName}>{investorName}</strong></span></div>
              <div><MapPin size={16} aria-hidden="true" /><span><small>Lokalizacja</small><strong title={location}>{location}</strong></span></div>
            </div>

            {canUpload ? <div className="pw-project-header__intake"><ProjectIntakeSlot projectId={project.id} /></div> : null}
          </header>

          <ProjectNavigation projectId={project.id} allowedDomains={allowedProjectDomains} />
        </section>

        {allowedProjectDomains.includes("investments") ? (
          <ProjectAutopilotRouteGate projectId={project.id}>
            <Suspense fallback={null}><AsyncProjectAutopilotDock projectId={project.id} canRun={canUpload} /></Suspense>
          </ProjectAutopilotRouteGate>
        ) : null}
        {children}
      </main>
    </CompanyShell>
  );
}
