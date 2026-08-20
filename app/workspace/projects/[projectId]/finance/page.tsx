import { CircleDollarSign, TrendingUp } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { CompactDisclosureGroup } from "@/components/ui/compact-disclosure-group";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProjectModuleLiveMetrics } from "@/lib/data/project-module-kpis";
import { getProjectForUser } from "@/lib/data/projects";
import { PROJECT_MODULES } from "@/lib/product/project-modules";
import "../../../../project-finance-compact.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectFinancePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();

  if (!await hasDomainAccess({
    workspaceId: project.workspace_id,
    userId: user.id,
    domain: "finance",
    level: "read",
    projectId: project.id
  })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area="Finanse projektu" />;
  }

  const metrics = await getProjectModuleLiveMetrics(project.workspace_id, project.id, PROJECT_MODULES.finance);
  const marginMetric = metrics.find((metric) => metric.label.toLocaleLowerCase("pl").includes("marża"));
  const marginWarning = marginMetric?.tone === "warning";

  return (
    <div className="project-tab-content pw-finance-compact">
      <section className="pw-finance-compact__hero">
        <div className="pw-finance-compact__title">
          <span className="pw-finance-compact__icon"><CircleDollarSign size={19} aria-hidden="true" /></span>
          <div>
            <p className="co-kicker">Finanse</p>
            <h2>Finanse inwestycji</h2>
          </div>
        </div>
        <span className={`pw-finance-compact__signal${marginWarning ? " is-warning" : ""}`}>
          <TrendingUp size={14} aria-hidden="true" />
          {marginMetric ? `Marża: ${marginMetric.value}` : "KPI na żywo"}
        </span>
      </section>

      <section className="pw-finance-kpis" aria-label="Kluczowe wskaźniki finansowe">
        {metrics.map((metric) => (
          <article key={metric.label} className={`pw-finance-kpi pw-finance-kpi--${metric.tone ?? "default"}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </section>

      <CompactDisclosureGroup
        className="compact-disclosure-group--finance"
        items={[
          { id: "operation-budget", label: "Budżet / nowa wersja" },
          { id: "operation-change_order", label: "Zmiana kontraktowa" },
          { id: "finance-register", label: "Budżety, forecast i historia" }
        ]}
      >
        <ProjectOperationPanel projectId={projectId} mode="budget" />
        <ProjectOperationPanel projectId={projectId} mode="change_order" />
        <ProjectLiveRecords projectId={projectId} kind="finance" />
      </CompactDisclosureGroup>
    </div>
  );
}
