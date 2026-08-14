import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Database, Sparkles, UploadCloud } from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import type { ProjectModuleDefinition } from "@/lib/product/project-modules";

type ProjectModulePageProps = {
  projectId: string;
  module: ProjectModuleDefinition;
  children?: React.ReactNode;
};

export async function ProjectModulePage({ projectId, module, children }: ProjectModulePageProps) {
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) notFound();

  return (
    <div className="project-tab-content">
      <section className="project-module-heading">
        <div>
          <p className="eyebrow">{module.eyebrow}</p>
          <h2>{module.title}</h2>
          <p>{module.description}</p>
        </div>
        <Link href={`/workspace/projects/${project.id}/documentation?upload=1`} className="primary-button">
          <UploadCloud size={17} aria-hidden="true" />
          {module.primaryAction}
        </Link>
      </section>

      <section className="metric-grid metric-grid--project">
        {module.metrics.map((metric) => (
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
