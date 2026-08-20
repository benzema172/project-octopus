import Link from "next/link";
import { notFound } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { CompanyActionCenter } from "@/components/company/company-action-center";
import { requireCurrentUser } from "@/lib/auth";
import { domainAccessPolicyAllows, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { getCompanyActionCenter, refreshOperationalNotifications } from "@/lib/data/company-action-center";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";
type CompanyDashboardProps = { params: Promise<{ workspaceId: string }> };

function actionDomain(domain: string): Domain {
  if (domain === "finance" || domain === "hr" || domain === "warehouse" || domain === "fleet" || domain === "reports" || domain === "templates" || domain === "settings") return domain;
  return "investments";
}

export default async function CompanyDashboard({ params }: CompanyDashboardProps) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();

  const accessPolicy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const [allProjects, actionItems] = await Promise.all([
    listProjectsForWorkspace(user, workspace.id),
    getCompanyActionCenter(workspace.id, 100).catch(() => [])
  ]);
  void refreshOperationalNotifications(workspace.id).catch(() => null);

  const projects = allProjects.filter((project) => domainAccessPolicyAllows(accessPolicy, { domain: "investments", level: "read", projectId: project.id }));
  const visibleActions = actionItems.filter((item) => domainAccessPolicyAllows(accessPolicy, { domain: actionDomain(item.domain), level: "read", projectId: item.projectId }));
  const activeProjects = projects.filter((project) => project.status === "active").length;
  const criticalActions = visibleActions.filter((item) => item.severity === "critical").length;
  const canUploadCompany = domainAccessPolicyAllows(accessPolicy, { domain: "investments", level: "write", projectId: null });

  return <main className="co-page co-dashboard-simplified">
    <header className="co-page-heading co-page-heading--compact">
      <div>
        <p className="co-kicker">Pulpit firmy</p>
        <h1>{workspace.name}</h1>
        <p>{workspace.industry || "Najważniejsze decyzje i aktywne realizacje"}</p>
      </div>
      <div className="co-company-address">
        <strong>{workspace.city || "Firma"}</strong>
        <span>{workspace.tax_id ? `NIP ${workspace.tax_id}` : "Uzupełnij dane w Ustawieniach"}</span>
        {canUploadCompany ? <Link href={`/workspace/companies/${workspace.id}/documents?upload=1`} className="co-primary-button"><UploadCloud size={17} aria-hidden="true" /> Wrzutnia</Link> : null}
      </div>
    </header>

    <section className="co-metric-grid co-metric-grid--decision" aria-label="Najważniejsze informacje">
      <article className="co-metric-card"><span>Aktywne inwestycje</span><strong>{activeProjects}</strong><small>{projects.length} wszystkich realizacji</small></article>
      <article className="co-metric-card"><span>Do zrobienia</span><strong>{visibleActions.length}</strong><small>decyzje i wyjątki wymagające reakcji</small></article>
      <article className={`co-metric-card${criticalActions ? " co-metric-card--danger" : ""}`}><span>Krytyczne</span><strong>{criticalActions}</strong><small>{criticalActions ? "wymagają pilnej reakcji" : "brak pilnych blokad"}</small></article>
    </section>

    <CompanyActionCenter items={visibleActions} />

    <section className="co-section co-section--compact">
      <div className="co-section-heading">
        <div><p className="co-kicker">Inwestycje</p><h2>Aktualne realizacje</h2></div>
        <Link href={`/workspace/companies/${workspace.id}/investments`} className="co-text-link">Wszystkie inwestycje →</Link>
      </div>
      {projects.length ? <div className="co-project-strip">{projects.slice(0,6).map((project)=><Link href={`/workspace/projects/${project.id}`} key={project.id}><span>{project.status}</span><strong>{project.name}</strong><small>{project.location || project.investor_name || "Brak lokalizacji"}</small></Link>)}</div> : <div className="co-empty-state"><strong>Nie ma jeszcze inwestycji.</strong><p>Dodaj pierwszą inwestycję w module Inwestycje.</p></div>}
    </section>
  </main>;
}
