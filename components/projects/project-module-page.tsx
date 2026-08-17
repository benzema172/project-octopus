import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Database, Sparkles } from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { getProjectForUser } from "@/lib/data/projects";
import type { ProjectModuleDefinition } from "@/lib/product/project-modules";
import type { ModuleMetric } from "@/lib/product/modules";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type ProjectModuleKind = "finance" | "team" | "warehouse" | "reports";

type ProjectModulePageProps = {
  projectId: string;
  module: ProjectModuleDefinition;
  requiredDomain?: Domain;
  kind?: ProjectModuleKind;
  children?: React.ReactNode;
};

function number(value: unknown) {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

function money(value: unknown) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

async function loadLiveMetrics(kind: ProjectModuleKind | undefined, workspaceId: string, projectId: string): Promise<ModuleMetric[] | null> {
  if (!kind) return null;
  const supabase = createServiceSupabaseClient();
  if (kind === "finance") {
    const [budgetResult, allocationsResult, commitmentsResult, forecastResult] = await Promise.all([
      supabase.from("budgets").select("total_revenue,total_cost,status,version_number").eq("workspace_id", workspaceId).eq("project_id", projectId).order("version_number", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("financial_allocations").select("amount").eq("workspace_id", workspaceId).eq("project_id", projectId).eq("status", "approved"),
      supabase.from("commitments").select("amount").eq("workspace_id", workspaceId).eq("project_id", projectId).in("status", ["open", "approved"]),
      supabase.from("forecast_snapshots").select("forecast_margin,estimate_at_completion,forecast_date").eq("workspace_id", workspaceId).eq("project_id", projectId).order("forecast_date", { ascending: false }).limit(1).maybeSingle()
    ]);
    const actual = (allocationsResult.data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const committed = (commitmentsResult.data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    return [
      { label: "Budżet przychodu", value: budgetResult.data ? money(budgetResult.data.total_revenue) : "—", detail: budgetResult.data ? `wersja ${budgetResult.data.version_number} · ${budgetResult.data.status}` : "Brak wersji budżetu" },
      { label: "Koszt zatwierdzony", value: money(actual), detail: `${allocationsResult.data?.length ?? 0} alokacji źródłowych` },
      { label: "Zaangażowanie", value: money(committed), detail: `${commitmentsResult.data?.length ?? 0} otwartych zobowiązań` },
      { label: "Marża prognozowana", value: forecastResult.data?.forecast_margin == null ? "—" : money(forecastResult.data.forecast_margin), detail: forecastResult.data ? `EAC ${money(forecastResult.data.estimate_at_completion)}` : "Uruchom forecast", tone: Number(forecastResult.data?.forecast_margin ?? 0) < 0 ? "danger" : "positive" }
    ];
  }
  if (kind === "team") {
    const [assignmentsResult, timeResult] = await Promise.all([
      supabase.from("assignments").select("id,employee_id,allocation_percent,date_from,date_to").eq("workspace_id", workspaceId).eq("project_id", projectId),
      supabase.from("timesheets").select("hours,overtime_hours,status").eq("workspace_id", workspaceId).eq("project_id", projectId)
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const active = (assignmentsResult.data ?? []).filter((row) => (!row.date_from || row.date_from <= today) && (!row.date_to || row.date_to >= today));
    const approvedTime = (timeResult.data ?? []).filter((row) => row.status === "approved");
    const hours = approvedTime.reduce((sum, row) => sum + Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0), 0);
    const allocation = active.reduce((sum, row) => sum + Number(row.allocation_percent ?? 0), 0);
    return [
      { label: "Zespół aktywny", value: String(new Set(active.map((row) => row.employee_id)).size), detail: `${active.length} aktywnych przypisań` },
      { label: "Zaangażowanie", value: `${number(allocation)}%`, detail: "suma bieżących alokacji" },
      { label: "Czas zatwierdzony", value: `${number(hours)} h`, detail: `${approvedTime.length} wpisów czasu` },
      { label: "Do decyzji", value: String((timeResult.data ?? []).filter((row) => row.status === "submitted").length), detail: "wpisy czasu oczekujące", tone: "warning" }
    ];
  }
  if (kind === "warehouse") {
    const [reservationsResult, chainResult] = await Promise.all([
      supabase.from("reservations").select("id,stock_item_id,status,required_at").eq("workspace_id", workspaceId).eq("project_id", projectId),
      supabase.from("material_chain_events").select("id,stock_item_id,stage,status").eq("workspace_id", workspaceId).eq("project_id", projectId)
    ]);
    const reservations = reservationsResult.data ?? [];
    const chain = chainResult.data ?? [];
    return [
      { label: "Rezerwacje otwarte", value: String(reservations.filter((row) => row.status === "open").length), detail: `${reservations.length} wszystkich rezerwacji` },
      { label: "Kartoteki powiązane", value: String(new Set([...reservations, ...chain].map((row) => row.stock_item_id).filter(Boolean)).size), detail: "materiały w przepływie projektu" },
      { label: "Zdarzenia łańcucha", value: String(chain.length), detail: "potrzeba, dostawa, wydanie, zużycie" },
      { label: "Wyjątki", value: String(chain.filter((row) => ["error", "blocked", "rejected"].includes(String(row.status))).length), detail: "wymagają reakcji", tone: "warning" }
    ];
  }
  const [definitionsResult, runsResult, snapshotsResult, notificationsResult] = await Promise.all([
    supabase.from("report_definitions").select("id").eq("workspace_id", workspaceId).eq("project_id", projectId),
    supabase.from("report_runs").select("id,status").eq("workspace_id", workspaceId).eq("project_id", projectId),
    supabase.from("report_snapshots").select("id").eq("workspace_id", workspaceId).eq("project_id", projectId),
    supabase.from("notifications").select("id,read_at").eq("workspace_id", workspaceId).eq("project_id", projectId)
  ]);
  return [
    { label: "Definicje raportów", value: String(definitionsResult.data?.length ?? 0), detail: "stały zakres i KPI" },
    { label: "Uruchomienia", value: String(runsResult.data?.length ?? 0), detail: `${(runsResult.data ?? []).filter((row) => row.status === "queued").length} w kolejce` },
    { label: "Zamknięte snapshoty", value: String(snapshotsResult.data?.length ?? 0), detail: "niezmienna historia" },
    { label: "Nieprzeczytane alerty", value: String((notificationsResult.data ?? []).filter((row) => !row.read_at).length), detail: "wyjątki projektu", tone: "warning" }
  ];
}

export async function ProjectModulePage({ projectId, module, requiredDomain, kind, children }: ProjectModulePageProps) {
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
  const liveMetrics = await loadLiveMetrics(kind, project.workspace_id, project.id);
  const metrics = liveMetrics ?? module.metrics;
  const primaryHref = kind === "reports" ? `/workspace/companies/${project.workspace_id}/reports` : "#module-actions";

  return (
    <div className="project-tab-content">
      <section className="project-module-heading">
        <div>
          <p className="eyebrow">{module.eyebrow}</p>
          <h2>{module.title}</h2>
          <p>{module.description}</p>
        </div>
        <Link href={primaryHref} className="primary-button">
          <ArrowRight size={17} aria-hidden="true" />
          {module.primaryAction}
        </Link>
      </section>

      <p className="project-metric-caption">KPI na żywo · wyłącznie z rekordów dostępnych w tej domenie</p>
      <section className="metric-grid metric-grid--project">
        {metrics.map((metric) => (
          <article key={metric.label} className={`metric-card metric-card--${metric.tone ?? "default"}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      <section id="module-actions">{children}</section>

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
