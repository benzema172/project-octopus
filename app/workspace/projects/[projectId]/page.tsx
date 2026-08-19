import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  Flag,
  TrendingUp,
  WalletCards
} from "lucide-react";
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

function money(value: number | null | undefined) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(value) + " zł";
}

function dateLabel(value: Date | null) {
  return value ? new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value) : "—";
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

const EMPTY_DASHBOARD: ProjectDashboardSnapshot = {
  documentsCount: 0,
  boqValue: 0,
  acceptedWorkValue: 0,
  closeoutRequired: 0,
  closeoutComplete: 0,
  alerts: [],
  milestones: [],
  risks: [],
  forecast: null
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();

  const investmentsAllowed = await hasDomainAccess({
    workspaceId: project.workspace_id,
    userId: user.id,
    domain: "investments",
    level: "read",
    projectId: project.id
  });
  if (!investmentsAllowed) return <DomainAccessDenied workspaceId={project.workspace_id} area="Inwestycja" />;

  const [profile, schemaReady, financeAllowed] = await Promise.all([
    getProjectProfile(project),
    isExecutionLayerSchemaReady(),
    hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "finance", level: "read", projectId: project.id })
  ]);

  let dashboard = EMPTY_DASHBOARD;
  if (schemaReady) {
    try {
      dashboard = await getProjectDashboardSnapshot(project.workspace_id, project.id, financeAllowed);
    } catch (error) {
      console.error("Project Octopus: lightweight dashboard snapshot unavailable", { projectId: project.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const { documentsCount, boqValue, acceptedWorkValue, closeoutRequired, closeoutComplete, alerts, milestones, risks, forecast } = dashboard;
  const base = `/workspace/projects/${project.id}`;
  const today = new Date();
  const start = parseDate(profile.startDate);
  const finish = parseDate(profile.completionDate);
  const hasContractDates = Boolean(start && finish && finish.getTime() > start.getTime());
  const elapsed = hasContractDates && start && finish
    ? clamp(((today.getTime() - start.getTime()) / (finish.getTime() - start.getTime())) * 100)
    : 0;
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
  const costProgress = actualCost != null && estimateAtCompletion && estimateAtCompletion > 0
    ? clamp(actualCost / estimateAtCompletion * 100)
    : null;

  return (
    <div className="project-tab-content pw-dashboard pw-dashboard--combined">
      {!schemaReady ? <ExecutionLayerNotice /> : null}

      <section className="pw-time-card">
        <div className="pw-time-card__count">
          <p className="co-kicker">Czas do zakończenia</p>
          <strong>{daysRaw == null ? "—" : daysLate > 0 ? `+${daysLate}` : daysRemaining}</strong>
          <span>{daysRaw == null ? "uzupełnij termin kontraktowy" : daysLate > 0 ? "dni po terminie" : "dni do zakończenia"}</span>
          <small><CalendarDays size={14} /> Termin kontraktowy: {dateLabel(finish)}</small>
        </div>

        <div className="pw-time-card__timeline">
          <div className="pw-card-title-row"><p className="co-kicker">Wykorzystanie czasu kontraktowego</p><b>{hasContractDates ? `${Math.round(elapsed)}%` : "—"}</b></div>
          <div className="pw-progress-track"><span style={{ width: `${elapsed}%` }} /></div>
          <div className="pw-time-dates">
            <div><small>Rozpoczęcie</small><strong><CalendarDays size={14} /> {dateLabel(start)}</strong></div>
            <div><small>Termin kontraktowy</small><strong><CalendarDays size={14} /> {dateLabel(finish)}</strong></div>
          </div>
          <div className="pw-info-strip"><Clock3 size={15} /> {daysRaw == null ? "Uzupełnij daty w karcie inwestycji." : daysLate > 0 ? `Termin przekroczony o ${daysLate} dni.` : `Do zakończenia pozostało ${daysRemaining} dni.`}</div>
        </div>

        <Link href={`${base}/closeout`} className="pw-readiness-card">
          <p className="co-kicker">Gotowość do odbioru</p>
          <div className="pw-readiness-ring" style={{ background: `conic-gradient(#8a2be2 0 ${(readiness ?? 0) * 3.6}deg, #00aeb0 ${(readiness ?? 0) * 3.6}deg, #eee8f3 ${(readiness ?? 0) * 3.6}deg 360deg)` }}>
            <span>{readiness == null ? "—" : `${readiness}%`}</span>
          </div>
          <small>{closeoutRequired ? `${closeoutComplete}/${closeoutRequired} pozycji` : `${documentsCount} plików źródłowych`}</small>
          <b>Zobacz kompletność <ArrowRight size={14} /></b>
        </Link>
      </section>

      <section className="pw-finance-card">
        <div className="pw-card-title-row">
          <div><p className="co-kicker">Podsumowanie finansowe</p><h2>Finanse inwestycji</h2></div>
          <small>{financeAllowed ? "Wyłącznie dane zatwierdzone" : "Dostęp chroniony rolą Finanse"}</small>
        </div>
        {financeAllowed ? <>
          <div className="pw-finance-metrics">
            <div><span className="pw-finance-icon"><WalletCards size={19} /></span><small>Wartość kontraktu</small><strong>{money(contractValue)}</strong><p>karta inwestycji / forecast</p></div>
            <div><span className="pw-finance-icon"><WalletCards size={19} /></span><small>Koszt poniesiony</small><strong>{money(actualCost)}</strong><p>zatwierdzone alokacje</p></div>
            <div><span className="pw-finance-icon"><TrendingUp size={19} /></span><small>EAC</small><strong>{money(estimateAtCompletion)}</strong><p>prognoza kosztu końcowego</p></div>
            <div className={forecastMargin != null && forecastMargin >= 0 ? "pw-finance-metric--profit" : undefined}><span className="pw-finance-icon"><BarChart3 size={19} /></span><small>Marża prognozowana</small><strong>{money(forecastMargin)}</strong><p>z ostatniego forecastu</p></div>
          </div>
          <div className="pw-budget-row">
            <div className="pw-budget-main">
              <div className="pw-card-title-row"><span>Realizacja kosztu prognozowanego</span><b>{costProgress == null ? "—" : `${costProgress.toFixed(1).replace(".", ",")}%`}</b></div>
              <div className="pw-progress-track"><span style={{ width: `${costProgress ?? 0}%` }} /></div>
              <div className="pw-budget-labels"><small>Poniesiono: {money(actualCost)}</small><small>Pozostało wg EAC: {actualCost != null && estimateAtCompletion != null ? money(Math.max(0, estimateAtCompletion - actualCost)) : "—"}</small></div>
            </div>
            <Link href={`${base}/progress`} className="pw-work-value"><BarChart3 size={20} /><span><small>Przerób odebrany</small><strong>{money(acceptedWorkValue || null)}</strong><b>{workProgress == null ? "Brak zatwierdzonego BOQ" : `${workProgress.toFixed(1).replace(".", ",")}% BOQ`}</b></span><ArrowRight size={16} /></Link>
          </div>
        </> : <div className="pw-protected-data"><WalletCards size={22} /><div><strong>Dane finansowe są ukryte</strong><p>Administrator może nadać rolę Finanse globalnie albo tylko dla tej inwestycji.</p></div></div>}
      </section>

      <section className="pw-ops-grid pw-ops-grid--primary">
        <article className="pw-ops-card pw-progress-card">
          <div className="pw-card-title-row"><p className="co-kicker">Postęp robót</p><BarChart3 size={17} /></div>
          <div className="pw-progress-content">
            <div className="pw-donut" style={{ background: `conic-gradient(#8a2be2 0 ${(workProgress ?? 0) * 3.6}deg, #1e73e9 ${(workProgress ?? 0) * 3.6}deg, #eee9f2 ${(workProgress ?? 0) * 3.6}deg 360deg)` }}><span><strong>{workProgress == null ? "—" : `${Math.round(workProgress)}%`}</strong><small>odebranego BOQ</small></span></div>
            <dl><div><dt>Planowany koniec</dt><dd>{dateLabel(finish)}</dd></div><div><dt>Pozostało</dt><dd>{daysRemaining == null ? "—" : `${daysRemaining} dni`}</dd></div><div><dt>Podstawa</dt><dd>{boqValue > 0 ? "Zatwierdzony BOQ" : "Brak baseline BOQ"}</dd></div></dl>
          </div>
          <Link href={`${base}/progress`}>Przejdź do przerobu <ArrowRight size={14} /></Link>
        </article>

        <article className="pw-ops-card pw-alert-card">
          <div className="pw-card-title-row"><p className="co-kicker">Alerty OctopusAI</p><span className="pw-alert-count">{alerts.length}</span></div>
          <div className="pw-list-stack">
            {alerts.map((alert) => <div className={`pw-alert-row pw-alert-row--${alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}`} key={alert.id}><AlertTriangle size={16} /><span><strong>{alert.title}</strong><small>{alert.description || "Otwórz Brain, aby sprawdzić źródło i kontekst."}</small></span></div>)}
            {!alerts.length ? <p className="empty-copy">Brak zapisanych alertów opartych na danych.</p> : null}
          </div>
          <Link href={`${base}/brain`}>Przejdź do analizy AI <ArrowRight size={14} /></Link>
        </article>
      </section>

      <section className="pw-ops-grid pw-ops-grid--two">
        <article className="pw-ops-card">
          <div className="pw-card-title-row"><p className="co-kicker">Kamienie milowe</p><Flag size={17} /></div>
          <div className="pw-milestone-list">
            {milestones.map((item) => { const done = Boolean(item.actual_finish) || ["complete", "completed", "closed"].includes(item.status); const current = !done && ["active", "in_progress", "started"].includes(item.status); return <div className={`pw-milestone-row pw-milestone-row--${done ? "done" : current ? "current" : "planned"}`} key={item.id}>{done ? <CheckCircle2 size={17} /> : <Circle size={17} />}<span><strong>{item.title}</strong><small>{item.planned_finish ?? item.planned_start ?? "Bez daty"}</small></span><b>{done ? "Zakończone" : current ? "W toku" : "Planowane"}</b></div>; })}
            {!milestones.length ? <p className="empty-copy">Brak zatwierdzonych zadań harmonogramu.</p> : null}
          </div>
          <Link href={`${base}/schedule`}>Zobacz pełny harmonogram <ArrowRight size={14} /></Link>
        </article>

        <article className="pw-ops-card">
          <div className="pw-card-title-row"><p className="co-kicker">Ryzyka zmian</p><TrendingUp size={17} /></div>
          <div className="pw-risk-list">
            {risks.map((risk) => <div className="pw-risk-row" key={risk.id}><i className={`pw-risk-dot pw-risk-dot--${risk.risk_level === "high" || risk.risk_level === "critical" ? "high" : risk.risk_level === "medium" ? "medium" : "low"}`} /><span><small>{risk.risk_level}</small><strong>{risk.summary}</strong></span><b>Do decyzji</b></div>)}
            {!risks.length ? <p className="empty-copy">Brak proponowanych skutków zmian.</p> : null}
          </div>
          <Link href={`/workspace/companies/${project.workspace_id}/ai-inbox`}>Otwórz Skrzynkę AI <ArrowRight size={14} /></Link>
        </article>
      </section>
    </div>
  );
}
