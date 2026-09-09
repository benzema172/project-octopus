import Link from "next/link";
import { Suspense } from "react";
import { Archive, ArrowLeft, Building2, LockKeyhole, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { CompanyShell } from "@/components/layout/company-shell";
import { ProjectAutopilotDock } from "@/components/projects/project-autopilot-dock";
import { ProjectAutopilotRouteGate } from "@/components/projects/project-autopilot-route-gate";
import { ProjectEquipmentStrip430 } from "@/components/projects/project-equipment-strip-430";
import { ProjectIntakeSlot } from "@/components/projects/project-intake-slot";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import { ProjectStatusControl550 } from "@/components/projects/project-status-control-550";
import { requireCurrentUser } from "@/lib/auth";
import { getReliableInvestmentAutopilotSummary } from "@/lib/data/investment-autopilot-summary";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectAiProposalPendingCount } from "@/lib/data/project-ai-proposals";
import { getProjectForUser } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getProjectHeaderModel560 } from "@/lib/investments/project-header-model-560";
import { domainAccessPolicyAllows, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import "../../../project-workspace-v2.css";
import "../../../project-intake.css";
import "../../../project-intake-progress.css";
import "../../../project-navigation-refinement.css";
import "../../../project-modules-operational.css";
import "../../../layout-density-project-audit.css";
import "../../../investment-ux-repair.css";
import "../../../investment-content-refinement.css";
import "../../../investment-card-typography.css";
import "../../../investment-menu-toggle-fix.css";
import "../../../wrzutnia-mascot-refinement.css";
import "../../../project-submodules-compact.css";
import "../../../project-team-worklog-570.css";
import "../../../project-section-rhythm-final.css";
import "../../../project-actions.css";
import "../../../project-intelligence-130.css";
import "../../companies/company-cleanup.css";

export const dynamic = "force-dynamic";
type ProjectLayoutProps = { children: React.ReactNode; params: Promise<{ projectId: string }> };

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

  const [profile, workspace, policy, aiProposalCount] = await Promise.all([
    getProjectProfile(project),
    getWorkspaceForUser(user, project.workspace_id),
    loadDomainAccessPolicy({ workspaceId: project.workspace_id, userId: user.id }),
    getProjectAiProposalPendingCount(project.workspace_id, project.id)
  ]);
  if (!workspace) notFound();

  const domains: Domain[] = ["investments", "finance", "hr", "warehouse", "fleet", "templates", "reports", "settings"];
  const allowedProjectDomains = domains.filter((domain) => domainAccessPolicyAllows(policy, { domain, level: "read", projectId: project.id }));
  const allowedCompanyDomains = domains.filter((domain) => domainAccessPolicyAllows(policy, { domain, level: "read", projectId: null }));
  const canManageStatus = domainAccessPolicyAllows(policy, { domain: "investments", level: "write", projectId: project.id });
  const lifecycleReadOnly = ["completed", "archived"].includes(String(project.status));
  const canUpload = !lifecycleReadOnly && canManageStatus;
  const header = getProjectHeaderModel560(project, profile);

  return (
    <CompanyShell workspaceId={workspace.id} companyName={workspace.name} userEmail={user.email ?? "Project Octopus"} allowedDomains={allowedCompanyDomains}>
      <main className="workspace-page project-workspace co-project-workspace project-workspace-v2" data-project-lifecycle-status={String(project.status)}>
        <section className="pw-project-top-shell" aria-label="Nagłówek i nawigacja inwestycji">
          <header className="pw-project-header pw-project-header--contract pw-project-header--compact pw-project-header--with-intake">
            <div className="pw-project-header__identity">
              <Link href={`/workspace/companies/${workspace.id}/investments`} className="pw-project-header__back" aria-label="Wszystkie inwestycje" title="Wszystkie inwestycje"><ArrowLeft size={15} aria-hidden="true" /></Link>
              <div><ProjectStatusControl550 projectId={project.id} status={String(project.status)} canManage={canManageStatus} variant="header" /><h1>„{header.shortName}”</h1></div>
            </div>

            <div className="pw-project-contract" aria-label="Dane kontraktowe inwestycji">
              <strong title={header.officialName}>{header.officialName}</strong>
              <span>Numer kontraktu: {header.contractNumber}</span>
            </div>

            <div className="pw-project-meta pw-project-meta--header">
              <div><Building2 size={16} aria-hidden="true" /><span><small>Inwestor</small><strong title={header.investorName}>{header.investorName}</strong></span></div>
              <div><MapPin size={16} aria-hidden="true" /><span><small>Lokalizacja</small><strong title={header.location}>{header.location}</strong></span></div>
            </div>

            {canUpload ? <div className="pw-project-header__intake"><ProjectIntakeSlot projectId={project.id} /></div> : null}
          </header>

          <ProjectNavigation projectId={project.id} allowedDomains={allowedProjectDomains} />
        </section>

        {lifecycleReadOnly ? <div className="project-operation-card__success" data-project-readonly-banner="540">
          {project.status === "archived" ? <Archive size={17} /> : <LockKeyhole size={17} />}
          <strong>{project.status === "archived" ? "Inwestycja w Archiwum." : "Inwestycja zakończona — poza bieżącą pracą."}</strong>
          <span>{project.status === "archived" ? "Pełna dokumentacja i historia są zachowane. Kliknij znacznik statusu przy nazwie inwestycji, aby przywrócić ją jako Zakończoną albo Aktywną do dalszej edycji." : "Nie można jej wybierać do nowych wpisów operacyjnych, w tym do pracy pracowników. Kliknij znacznik statusu, jeśli chcesz ją ponownie aktywować lub przenieść do Archiwum."}</span>
          <Link className="secondary-button" href={`/workspace/projects/${project.id}/closeout`}>{project.status === "archived" ? "Paczki archiwalne" : "Paczka przekazania"}</Link>
        </div> : null}

        {allowedProjectDomains.includes("warehouse") ? <ProjectEquipmentStrip430 workspaceId={project.workspace_id} projectId={project.id} /> : null}

        {!lifecycleReadOnly && aiProposalCount > 0 && allowedProjectDomains.includes("investments") ? <Link className="pw-ai-proposal-alert" href={`/workspace/projects/${project.id}/documentation#ai-review-center`}><span>AI</span><strong>{aiProposalCount} propozycji wymaga weryfikacji</strong><small>Otwórz centrum decyzji</small></Link> : null}

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
