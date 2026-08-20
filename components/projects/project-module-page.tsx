import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Database, Sparkles, UploadCloud } from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { getProjectModuleLiveMetrics } from "@/lib/data/project-module-kpis";
import { getProjectForUser } from "@/lib/data/projects";
import type { ProjectModuleDefinition } from "@/lib/product/project-modules";

type ProjectModulePageProps = {
  projectId: string;
  module: ProjectModuleDefinition;
  requiredDomain?: Domain;
  children?: React.ReactNode;
};

function primaryHref(projectId: string, module: ProjectModuleDefinition) {
  const title = module.title.toLocaleLowerCase("pl");
  const action = module.primaryAction.toLocaleLowerCase("pl");
  const base = `/workspace/projects/${projectId}`;
  if (title.includes("kosztorys") || action.includes("importuj")) return `${base}/documentation?upload=1&category=estimate`;
  if (title.includes("wnioski materiałowe") || action.includes("wniosek")) return `${base}/requests#operation-requirement`;
  if (title.includes("protoko") || action.includes("protok")) return `${base}/protocols#operation-protocol`;
  if (title.includes("harmonogram") || action.includes("baseline")) return `${base}/schedule#operation-schedule`;
  if (title.includes("przerób") || action.includes("okres przerobu")) return `${base}/progress#operation-progress_period`;
  if (title.includes("finanse") || action.includes("budżet")) return `${base}/finance#operation-budget`;
  if (title.includes("zespół") || action.includes("pracownik")) return `${base}/team#operation-assignment`;
  if (title.includes("magazyn") || action.includes("rezerw")) return `${base}/warehouse#operation-reservation`;
  if (title.includes("flota") || action.includes("pojazd")) return `${base}/fleet`;
  if (title.includes("zamknię") || title.includes("odbior")) return `${base}/closeout`;
  if (title.includes("dokument") || action.includes("dokument")) return `${base}/documentation?upload=1`;
  return `${base}/brain`;
}

export async function ProjectModulePage({ projectId, module, requiredDomain, children }: ProjectModulePageProps) {
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) notFound();

  if (requiredDomain && !await hasDomainAccess({
    workspaceId: project.workspace_id,
    userId: user.id,
    domain: requiredDomain,
    level: "read",
    projectId: project.id
  })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area={module.title} />;
  }

  const liveMetrics = await getProjectModuleLiveMetrics(project.workspace_id, project.id, module);
  const actionHref = primaryHref(project.id, module);

  return (
    <div className="project-tab-content">
      <section className="project-module-heading">
        <div>
          <p className="eyebrow">{module.eyebrow}</p>
          <h2>{module.title}</h2>
          <p>{module.description}</p>
        </div>
        <Link href={actionHref} className="primary-button">
          <UploadCloud size={17} aria-hidden="true" />
          {module.primaryAction}
        </Link>
      </section>

      <p className="project-metric-caption">KPI na żywo · wyłącznie z aktualnych danych inwestycji</p>
      <section className="metric-grid metric-grid--project">
        {liveMetrics.map((metric) => (
          <article key={metric.label} className={`metric-card metric-card--${metric.tone ?? "default"}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      {children}

      <section className="project-module-grid">
        {module.areas.map((area) => (
          <article key={area.title} className="capability-card">
            <Database size={18} aria-hidden="true" />
            <h3>{area.title}</h3>
            <p>{area.description}</p>
            <small>Źródło: {area.source}</small>
          </article>
        ))}
      </section>

      <section className="project-ai-note">
        <Sparkles size={20} aria-hidden="true" />
        <div>
          <p className="eyebrow">Rola Octopus Brain</p>
          <p>{module.aiNote}</p>
        </div>
      </section>

      <section className="section-band">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Kolejne działania</p>
            <h2>Kolejka uruchomienia</h2>
          </div>
        </div>
        <div className="workflow-list">
          {module.queue.map((item, index) => (
            <article key={item.title} className="workflow-row">
              <span className="workflow-row__number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.context}</p>
              </div>
              <span className="status-chip">{item.state}</span>
            </article>
          ))}
        </div>
        <Link href={`/workspace/projects/${project.id}/brain`} className="text-link">
          Zobacz Project DNA i źródła <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
