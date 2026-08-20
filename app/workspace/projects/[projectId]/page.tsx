import Link from "next/link";
import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, ChevronDown, Circle, FileText, Flag, TrendingUp, WalletCards } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";
import { hasDomainAccess } from "@/lib/authorization";
import { requireCurrentUser } from "@/lib/auth";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { getProjectDashboardSnapshot, type ProjectDashboardSnapshot } from "@/lib/data/project-dashboard-snapshot";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";
import { parseLocalizedNumber } from "@/lib/numbers/parse-localized-number";
import "../../../project-dashboard-combined.css";
import "../../../project-dashboard-compact.css";
import "../../../project-dashboard-layout-refinement.css";

export const dynamic = "force-dynamic";
type ProjectPageProps = { params: Promise<{ projectId: string }> };
const DAY = 86_400_000;

function parseDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function money(value: number | null | undefined) { return value == null ? "—" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(value) + " zł"; }
function dateLabel(value: Date | null) { return value ? new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value) : "—"; }
function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }

const EMPTY_DASHBOARD: ProjectDashboardSnapshot = { documentsCount: 0, boqValue: 0, acceptedWorkValue: 0, closeoutRequired: 0, closeoutComplete: 0, alerts: [], milestones: [], risks: [], forecast: null };

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();

  const investmentsAllowed = await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id });
  if (!investmentsAllowed) return <DomainAccessDenied workspaceId={project.workspace_id} area="Inwestycja" />;

  const [profile, schemaReady, financeAllowed] = await Promise.all([
    getProjectProfile(project),
    isExecutionLayerSchemaReady(),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "read", projectId: project.id })
  ]);

  let dashboard = EMPTY_DASHBOARD;
  if (schemaReady) {
    try { dashboard = await getProjectDashboardSnapshot(project.workspace_id, project.id, financeAllowed); }
    catch (error) { console.error("Project Octopus: lightweight dashboard snapshot unavailable", { projectId: project.id, message: error instanceof Error ? error.message : String(error) }); }
  }

  const { documentsCount, boqValue, acceptedWorkValue, closeoutRequired, closeoutComplete, alerts, milestones, risks, forecast } = dashboard;
  const base = `/workspace/projects/${project.id}`;
  const today = new Date();
  const start = parseDate(profile.startDate);
  const finish = parseDate(profile.completionDate);
  const hasContractDates = Boolean(start && finish && finish.getTime() > start.getTime());
  const elapsed = hasContractDates && start && finish ? clamp(((today.getTime() - start.getTime()) / (finish.getTime() - start.getTime())) * 100) : 0;
  const daysRaw = finish ? Math.ceil((finish.getTime() - today.getTime()) / DAY) : null;
  const daysRemaining = daysRaw == null ? null : Math.max(0, daysRaw);
  const daysLate = daysRaw == null ? 0 : Math.max(0, -daysRaw);
  const readiness = closeoutRequired ? Math.round(closeoutComplete / closeoutRequired * 100) : null;
  const workProgress = boqValue > 0 ? clamp(acceptedWorkValue / boqValue * 100) : null;
  const profileContractValue = parseLocalizedNumber(profile.contractValue);
  const contractValue = forecast?.contract_value ?? (profileContractValue > 0 ? profileContractValue : null);
  const actualCost = forecast?.actual_cost ?? null;
  const estimateAtCompletion = forecast?.estimate_at_completion ?? null;
  const forecastMargin = forecast?.forecast_margin ?? null;
  const attentionCount = alerts.length + risks.length;
  const currentMilestones = milestones.filter((item) => !Boolean(item.actual_finish) && !["complete", "completed", "closed"].includes(item.status)).slice(0, 5);

  return (
    <div className="project-tab-content pw-dashboard pw-dashboard--decision">
      {!schemaReady ? <ExecutionLayerNotice /> : null}

      <section className="pw-decision-grid" aria-label="Najważniejsze informacje inwestycji">
        <Link href={`${base}/schedule`} className={daysLate > 0 ? "is-danger" : undefined}>
          <CalendarDays size={18} aria-hidden="true" /><span><small>Termin</small><strong>{daysRaw == null ? "—" : daysLate > 0 ? `+${daysLate} dni` : `${daysRemaining} dni`}</strong><b>{dateLabel(finish)}</b></span>
        </Link>
        <Link href={`${base}/progress`}>
          <BarChart3 size={18} aria-hidden="true" /><span><small>Postęp</small><strong>{workProgress == null ? "—" : `${Math.round(workProgress)}%`}</strong><b>{money(acceptedWorkValue || null)} odebrane</b></span>
        </Link>
        {financeAllowed ? <Link href={`${base}/finance`} className={forecastMargin != null && forecastMargin < 0 ? "is-danger" : undefined}><WalletCards size={18} aria-hidden="true" /><span><small>Marża prognozowana</small><strong>{money(forecastMargin)}</strong><b>Koszt: {money(actualCost)}</b></span></Link> : <div className="pw-decision-protected"><WalletCards size={18}/><span><small>Finanse</small><strong>Chronione</strong><b>Brak roli Finanse</b></span></div>}
        <Link href={`${base}/brain`} className={attentionCount ? "is-warning" : undefined}>
          <AlertTriangle size={18} aria-hidden="true" /><span><small>Problemy</small><strong>{attentionCount}</strong><b>{alerts.length} alertów · {risks.length} ryzyk</b></span>
        </Link>
      </section>

      <section className="pw-action-center">
        <div className="pw-action-center__heading"><div><p className="co-kicker">Do zrobienia</p><h2>Rzeczy wymagające reakcji</h2></div><Link href={`/workspace/companies/${project.workspace_id}/ai-inbox`}>Wszystkie decyzje AI <ArrowRight size={14}/></Link></div>
        <div className="pw-action-list">
          {alerts.slice(0,5).map((alert) => <Link href={`${base}/brain`} className={`pw-action-row pw-action-row--${alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}`} key={`a-${alert.id}`}><AlertTriangle size={16}/><span><strong>{alert.title}</strong><small>{alert.description || "Sprawdź źródło i kontekst w Brain AI."}</small></span><ArrowRight size={14}/></Link>)}
          {risks.slice(0,5).map((risk) => <Link href={`/workspace/companies/${project.workspace_id}/ai-inbox`} className="pw-action-row pw-action-row--risk" key={`r-${risk.id}`}><TrendingUp size={16}/><span><strong>{risk.summary}</strong><small>Ryzyko: {risk.risk_level} · wymaga decyzji</small></span><ArrowRight size={14}/></Link>)}
          {!attentionCount ? <div className="pw-action-empty"><CheckCircle2 size={18}/><span><strong>Brak zapisanych problemów.</strong><small>OctopusAI nie wskazuje teraz wyjątków wymagających reakcji.</small></span></div> : null}
        </div>
      </section>

      <section className="pw-milestones-compact">
        <div className="pw-action-center__heading"><div><p className="co-kicker">Najbliższe</p><h2>Kamienie milowe</h2></div><Link href={`${base}/schedule`}>Pełny harmonogram <ArrowRight size={14}/></Link></div>
        <div className="pw-milestone-list">
          {currentMilestones.map((item) => <div className="pw-milestone-row pw-milestone-row--current" key={item.id}><Circle size={17}/><span><strong>{item.title}</strong><small>{item.planned_finish ?? item.planned_start ?? "Bez daty"}</small></span><b>{["active", "in_progress", "started"].includes(item.status) ? "W toku" : "Planowane"}</b></div>)}
          {!currentMilestones.length ? <p className="empty-copy">Brak otwartych kamieni milowych.</p> : null}
        </div>
      </section>

      <details className="pw-dashboard-more">
        <summary><span><Flag size={16}/><strong>Więcej danych inwestycji</strong><small>finanse, czas, odbiór i dokumentacja</small></span><ChevronDown size={16}/></summary>
        <div className="pw-dashboard-more__grid">
          <Link href={`${base}/finance`}><small>Wartość kontraktu</small><strong>{financeAllowed ? money(contractValue) : "Chronione"}</strong></Link>
          <Link href={`${base}/finance`}><small>EAC</small><strong>{financeAllowed ? money(estimateAtCompletion) : "Chronione"}</strong></Link>
          <Link href={`${base}/closeout`}><small>Gotowość do odbioru</small><strong>{readiness == null ? "—" : `${readiness}%`}</strong><span>{closeoutRequired ? `${closeoutComplete}/${closeoutRequired} pozycji` : "Brak checklisty"}</span></Link>
          <Link href={`${base}/schedule`}><small>Wykorzystanie czasu</small><strong>{hasContractDates ? `${Math.round(elapsed)}%` : "—"}</strong><span>{dateLabel(start)} → {dateLabel(finish)}</span></Link>
          <Link href={`${base}/documentation`}><small>Dokumenty</small><strong>{documentsCount}</strong><span>plików źródłowych</span></Link>
          <Link href={`${base}/progress`}><small>BOQ</small><strong>{money(boqValue || null)}</strong><span>podstawa przerobu</span></Link>
        </div>
      </details>
    </div>
  );
}
