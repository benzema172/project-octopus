import { notFound } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { getProjectModuleLiveMetrics } from "@/lib/data/project-module-kpis";
import { getProjectForUser } from "@/lib/data/projects";
import type { ProjectModuleDefinition } from "@/lib/product/project-modules";

type CompactMetric = {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
};

type ProjectCompactShellProps = {
  icon: LucideIcon;
  kicker: string;
  title: string;
  description: string;
  status?: string;
  aside?: React.ReactNode;
  metrics?: CompactMetric[];
  children?: React.ReactNode;
};

export function ProjectCompactShell({ icon: Icon, kicker, title, description, status, aside, metrics = [], children }: ProjectCompactShellProps) {
  return (
    <div className="project-tab-content pw-submodule-compact">
      <header className="pw-submodule-hero">
        <div className="pw-submodule-hero__title">
          <span className="pw-submodule-hero__icon"><Icon size={19} aria-hidden="true" /></span>
          <div>
            <p className="co-kicker">{kicker}</p>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        {aside ? <div className="pw-submodule-hero__aside">{aside}</div> : status ? <span className="pw-submodule-hero__status">{status}</span> : null}
      </header>

      {metrics.length ? (
        <section className="pw-submodule-metrics" aria-label="Wskaźniki modułu">
          {metrics.map((metric) => (
            <article key={metric.label} data-tone={metric.tone ?? "default"}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.hint ? <small>{metric.hint}</small> : null}
            </article>
          ))}
        </section>
      ) : null}

      {children}
    </div>
  );
}

type ProjectCompactModulePageProps = {
  projectId: string;
  module: ProjectModuleDefinition;
  icon: LucideIcon;
  requiredDomain?: Domain;
  children?: React.ReactNode;
};

export async function ProjectCompactModulePage({ projectId, module, icon, requiredDomain, children }: ProjectCompactModulePageProps) {
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

  return (
    <ProjectCompactShell
      icon={icon}
      kicker={module.eyebrow}
      title={module.title}
      description={module.description}
      status="KPI na żywo"
      metrics={liveMetrics.map((metric) => ({ label: metric.label, value: metric.value, hint: metric.detail, tone: metric.tone }))}
    >
      {children}
    </ProjectCompactShell>
  );
}
