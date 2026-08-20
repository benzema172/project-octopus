import Link from "next/link";
import { ArrowRight, Boxes, CalendarRange, FileCheck2, GitCompareArrows, LockKeyhole, PackageCheck, ShieldCheck, TrendingUp } from "lucide-react";
import type { ProjectExecutionSnapshot } from "@/lib/data/operations";
import { OperationsActionButton } from "@/components/projects/operations-action-button";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";

type ProjectExecutionCenterProps = {
  workspaceId: string;
  projectId: string;
  snapshot: ProjectExecutionSnapshot;
  financeAllowed: boolean;
  canManageFinance: boolean;
  warehouseAllowed: boolean;
  canManageInvestments: boolean;
};

export function ProjectExecutionCenter({ workspaceId, projectId, snapshot, financeAllowed, canManageFinance, warehouseAllowed, canManageInvestments }: ProjectExecutionCenterProps) {
  if (!snapshot.schemaReady) return <ExecutionLayerNotice />;
  const evidencePercent = snapshot.evidenceRequired ? Math.round(snapshot.evidenceComplete / snapshot.evidenceRequired * 100) : 0;
  const closeoutPercent = snapshot.closeoutRequired ? Math.round(snapshot.closeoutComplete / snapshot.closeoutRequired * 100) : 0;
  const base = `/workspace/projects/${projectId}`;
  const stages = [
    { label: "BOQ", value: snapshot.boqItems, icon: Boxes, href: `${base}/cost-estimate` },
    { label: "Wymagania", value: snapshot.requirements, icon: FileCheck2, href: `${base}/protocols` },
    { label: "Harmonogram", value: snapshot.scheduleActivities, icon: CalendarRange, href: `${base}/schedule` },
    { label: "Materiały", value: warehouseAllowed ? snapshot.materialEvents : "—", icon: PackageCheck, href: `${base}/warehouse` },
    { label: "Przerób", value: snapshot.progressEntries, icon: TrendingUp, href: `${base}/progress` },
    { label: "Dowody", value: `${evidencePercent}%`, icon: ShieldCheck, href: `${base}/closeout` }
  ];

  return <section className="control360-panel control360-execution">
    <header className="control360-panel__heading">
      <div><p className="co-kicker">Kompletność realizacji</p><h2>Od zakresu do odbioru</h2></div>
      <span>{closeoutPercent}% zamknięcia</span>
    </header>

    <div className="control360-stage-grid">
      {stages.map(({ icon: Icon, ...stage }) => <Link href={stage.href} key={stage.label} className="control360-stage">
        <Icon size={16} /><span><small>{stage.label}</small><strong>{stage.value}</strong></span><ArrowRight size={13} />
      </Link>)}
    </div>

    <div className="control360-decision-grid">
      <article className={snapshot.changeImpacts > 0 ? "is-warning" : ""}>
        <GitCompareArrows size={17} />
        <div><small>Zmiany do decyzji</small><strong>{snapshot.changeImpacts}</strong></div>
        <Link href={`/workspace/companies/${workspaceId}/ai-inbox`} aria-label="Otwórz decyzje"><ArrowRight size={15} /></Link>
      </article>

      <article>
        <TrendingUp size={17} />
        <div><small>Forecast</small><strong>{snapshot.latestForecast ? (snapshot.latestForecast.forecast_finish_date ?? "Aktualny") : "Brak"}</strong></div>
        {financeAllowed ? (canManageFinance ? <details className="control360-mini-action"><summary>Przelicz</summary><OperationsActionButton projectId={projectId} action="create_forecast" label="Przelicz forecast" /></details> : <span>odczyt</span>) : <LockKeyhole size={14} />}
      </article>

      <article>
        <ShieldCheck size={17} />
        <div><small>Gotowość do odbioru</small><strong>{closeoutPercent}%</strong></div>
        {canManageInvestments ? <details className="control360-mini-action"><summary>Odśwież</summary><OperationsActionButton projectId={projectId} action="initialize_closeout" label="Aktualizuj checklistę" /></details> : <Link href={`${base}/closeout`} aria-label="Otwórz zamknięcie"><ArrowRight size={15} /></Link>}
      </article>
    </div>
  </section>;
}
