import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  FileCheck2,
  Flag,
  TrendingUp,
  WalletCards
} from "lucide-react";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForProject } from "@/lib/data/documents";
import { getProjectProfile } from "@/lib/data/project-profile";
import { getProjectForUser } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

type ProjectPageProps = { params: Promise<{ projectId: string }> };

const DAY = 86_400_000;

function parseDate(value: string, fallback: string) {
  const parsed = new Date(value || fallback);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

function parseAmount(value: string, fallback: number) {
  if (!value) return fallback;
  const normalized = value.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function money(value: number) {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 }).format(value) + " zł";
}

function dateLabel(value: Date) {
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);

  if (!project) notFound();

  const profile = await getProjectProfile(project);
  let documentsCount = 0;
  try {
    documentsCount = (await listDocumentsForProject(project.id)).length;
  } catch (error) {
    console.error("Project Octopus: documents dashboard fallback", {
      projectId: project.id,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const base = `/workspace/projects/${project.id}`;
  const today = new Date();
  const start = parseDate(profile.startDate, "2026-03-02T00:00:00");
  const finish = parseDate(profile.completionDate, "2026-12-17T00:00:00");
  const totalDuration = Math.max(DAY, finish.getTime() - start.getTime());
  const elapsed = clamp(((today.getTime() - start.getTime()) / totalDuration) * 100);
  const daysRaw = Math.ceil((finish.getTime() - today.getTime()) / DAY);
  const daysRemaining = Math.max(0, daysRaw);
  const daysLate = Math.max(0, -daysRaw);

  const contractValue = parseAmount(profile.contractValue, 4_850_000);
  const currentCosts = 3_120_000;
  const currentResult = contractValue - currentCosts;
  const margin = contractValue > 0 ? (currentResult / contractValue) * 100 : 0;
  const budgetUsed = contractValue > 0 ? clamp((currentCosts / contractValue) * 100) : 0;
  const workValue = 2_230_000;
  const workProgress = 46;
  const readiness = Math.min(96, 62 + Math.min(documentsCount, 6));

  const receipts = [
    { title: "Odbiór instalacji wentylacji mechanicznej", date: "28.08.2026", status: "Zaplanowany" },
    { title: "Odbiór robót elewacyjnych — Etap II", date: "15.09.2026", status: "Zaplanowany" },
    { title: "Odbiór końcowy", date: dateLabel(finish), status: "Planowany" }
  ];

  const alerts = [
    { level: "danger", title: "Ryzyko opóźnienia robót instalacyjnych", text: "Aktualny postęp wskazuje ryzyko przesunięcia jednego z odbiorów o około 7 dni." },
    { level: "warning", title: "Niezatwierdzone materiały", text: "3 materiały oczekują na akceptację w sekcji Wnioski." },
    { level: "info", title: "Koszt robocizny powyżej planu", text: "Koszty robocizny są obecnie około 8% wyższe od wartości planowanej." }
  ];

  const milestones = [
    { title: "Podpisanie umowy", date: "20.02.2026", state: "done" },
    { title: "Rozpoczęcie robót", date: dateLabel(start), state: "done" },
    { title: "Zakończenie robót instalacyjnych", date: "30.09.2026", state: "current" },
    { title: "Odbiór końcowy", date: dateLabel(finish), state: "planned" }
  ];

  const risks = [
    { level: "Wysokie", title: "Wzrost cen materiałów", amount: "+120 000 zł", tone: "high" },
    { level: "Średnie", title: "Opóźnienie dostaw", amount: "+45 000 zł", tone: "medium" },
    { level: "Niskie", title: "Zmiany projektowe", amount: "+15 000 zł", tone: "low" }
  ];

  return (
    <div className="project-tab-content pw-dashboard pw-dashboard--combined">
      <section className="pw-time-card">
        <div className="pw-time-card__count">
          <p className="co-kicker">Czas do zakończenia</p>
          <strong>{daysLate > 0 ? `+${daysLate}` : daysRemaining}</strong>
          <span>{daysLate > 0 ? "dni po terminie" : "dni do zakończenia"}</span>
          <small><CalendarDays size={14} /> Termin kontraktowy: {dateLabel(finish)}</small>
        </div>

        <div className="pw-time-card__timeline">
          <div className="pw-card-title-row">
            <p className="co-kicker">Wykorzystanie czasu kontraktowego</p>
            <b>{Math.round(elapsed)}%</b>
          </div>
          <div className="pw-progress-track"><span style={{ width: `${elapsed}%` }} /></div>
          <div className="pw-time-dates">
            <div><small>Rozpoczęcie</small><strong><CalendarDays size={14} /> {dateLabel(start)}</strong></div>
            <div><small>Termin kontraktowy</small><strong><CalendarDays size={14} /> {dateLabel(finish)}</strong></div>
          </div>
          <div className="pw-info-strip"><Clock3 size={15} /> {daysLate > 0 ? `Termin przekroczony o ${daysLate} dni.` : `Do zakończenia pozostało ${daysRemaining} dni.`}</div>
        </div>

        <Link href={`${base}/documentation`} className="pw-readiness-card">
          <p className="co-kicker">Gotowość do odbioru</p>
          <div className="pw-readiness-ring" style={{ background: `conic-gradient(#8a2be2 0 ${readiness * 3.6}deg, #00aeb0 ${readiness * 3.6}deg, #eee8f3 ${readiness * 3.6}deg 360deg)` }}>
            <span>{readiness}%</span>
          </div>
          <small>{documentsCount} plików źródłowych</small>
          <b>Zobacz dokumentację <ArrowRight size={14} /></b>
        </Link>
      </section>

      <section className="pw-finance-card">
        <div className="pw-card-title-row">
          <div><p className="co-kicker">Podsumowanie finansowe</p><h2>Finanse inwestycji</h2></div>
          <small>Dane robocze dashboardu</small>
        </div>

        <div className="pw-finance-metrics">
          <div><span className="pw-finance-icon"><WalletCards size={19} /></span><small>Wartość kontraktu</small><strong>{money(contractValue)}</strong><p>wartość kontraktowa</p></div>
          <div><span className="pw-finance-icon"><WalletCards size={19} /></span><small>Aktualne koszty</small><strong>{money(currentCosts)}</strong><p>{budgetUsed.toFixed(1).replace(".", ",")}% wartości kontraktu</p></div>
          <div className="pw-finance-metric--profit"><span className="pw-finance-icon"><TrendingUp size={19} /></span><small>Aktualny wynik</small><strong>{currentResult >= 0 ? "+" : ""}{money(currentResult)}</strong><p>{currentResult >= 0 ? "zysk" : "strata"}</p></div>
          <div><span className="pw-finance-icon"><BarChart3 size={19} /></span><small>Marża</small><strong>{margin.toFixed(1).replace(".", ",")}%</strong><p>marża na dziś</p></div>
        </div>

        <div className="pw-budget-row">
          <div className="pw-budget-main">
            <div className="pw-card-title-row"><span>Wykorzystanie budżetu</span><b>{budgetUsed.toFixed(1).replace(".", ",")}%</b></div>
            <div className="pw-progress-track"><span style={{ width: `${budgetUsed}%` }} /></div>
            <div className="pw-budget-labels"><small>Wykorzystano: {money(currentCosts)}</small><small>Pozostało: {money(Math.max(0, contractValue - currentCosts))}</small></div>
          </div>
          <Link href={`${base}/progress`} className="pw-work-value">
            <BarChart3 size={20} />
            <span><small>Przerób narastająco</small><strong>{money(workValue)}</strong><b>{((workValue / contractValue) * 100).toFixed(1).replace(".", ",")}% kontraktu</b></span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <section className="pw-ops-grid">
        <article className="pw-ops-card pw-progress-card">
          <div className="pw-card-title-row"><p className="co-kicker">Postęp robót</p><BarChart3 size={17} /></div>
          <div className="pw-progress-content">
            <div className="pw-donut" style={{ background: `conic-gradient(#8a2be2 0 ${workProgress * 3.6}deg, #1e73e9 ${workProgress * 3.6}deg, #eee9f2 ${workProgress * 3.6}deg 360deg)` }}><span><strong>{workProgress}%</strong><small>zaawansowania</small></span></div>
            <dl>
              <div><dt>Planowany koniec</dt><dd>{dateLabel(finish)}</dd></div>
              <div><dt>Pozostało</dt><dd>{daysRemaining} dni</dd></div>
              <div><dt>Kamień milowy</dt><dd>Roboty instalacyjne</dd></div>
            </dl>
          </div>
          <Link href={`${base}/schedule`}>Przejdź do harmonogramu <ArrowRight size={14} /></Link>
        </article>

        <article className="pw-ops-card">
          <div className="pw-card-title-row"><p className="co-kicker">Najbliższe odbiory</p><FileCheck2 size={17} /></div>
          <div className="pw-list-stack">
            {receipts.map((item) => <div className="pw-receipt-row" key={item.title}><span><strong>{item.title}</strong><small>{item.date}</small></span><b>{item.status}</b></div>)}
          </div>
          <Link href={`${base}/protocols`}>Zobacz odbiory i protokoły <ArrowRight size={14} /></Link>
        </article>

        <article className="pw-ops-card pw-alert-card">
          <div className="pw-card-title-row"><p className="co-kicker">Alert OctopusAI</p><span className="pw-alert-count">{alerts.length} alerty</span></div>
          <div className="pw-list-stack">
            {alerts.map((alert) => <div className={`pw-alert-row pw-alert-row--${alert.level}`} key={alert.title}><AlertTriangle size={16} /><span><strong>{alert.title}</strong><small>{alert.text}</small></span></div>)}
          </div>
          <Link href={`${base}/brain`}>Przejdź do analizy AI <ArrowRight size={14} /></Link>
        </article>
      </section>

      <section className="pw-ops-grid pw-ops-grid--two">
        <article className="pw-ops-card">
          <div className="pw-card-title-row"><p className="co-kicker">Kamienie milowe</p><Flag size={17} /></div>
          <div className="pw-milestone-list">
            {milestones.map((item) => <div className={`pw-milestone-row pw-milestone-row--${item.state}`} key={item.title}>{item.state === "done" ? <CheckCircle2 size={17} /> : <Circle size={17} />}<span><strong>{item.title}</strong><small>{item.date}</small></span><b>{item.state === "done" ? "Zakończone" : item.state === "current" ? "W toku" : "Planowane"}</b></div>)}
          </div>
          <Link href={`${base}/schedule`}>Zobacz pełny harmonogram <ArrowRight size={14} /></Link>
        </article>

        <article className="pw-ops-card">
          <div className="pw-card-title-row"><p className="co-kicker">Ryzyka kosztowe</p><TrendingUp size={17} /></div>
          <div className="pw-risk-list">
            {risks.map((risk) => <div className="pw-risk-row" key={risk.title}><i className={`pw-risk-dot pw-risk-dot--${risk.tone}`} /><span><small>{risk.level}</small><strong>{risk.title}</strong></span><b>{risk.amount}</b></div>)}
          </div>
          <Link href={`${base}/cost-estimate`}>Przejdź do kosztorysu <ArrowRight size={14} /></Link>
        </article>
      </section>
    </div>
  );
}
