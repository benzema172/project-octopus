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
    { label: "Zakres BOQ", value: snapshot.boqItems, detail: `${snapshot.wbsNodes} pakietów WBS`, icon: Boxes, href: `${base}/cost-estimate` },
    { label: "Wymagania", value: snapshot.requirements, detail: `${snapshot.protocolsRequired} protokołów`, icon: FileCheck2, href: `${base}/protocols` },
    { label: "Harmonogram", value: snapshot.scheduleActivities, detail: "zadania powiązane z WBS", icon: CalendarRange, href: `${base}/schedule` },
    { label: "Łańcuch materiału", value: warehouseAllowed ? snapshot.materialEvents : "—", detail: warehouseAllowed ? "zdarzenia od wniosku do zużycia" : "dane chronione rolą Magazyn", icon: PackageCheck, href: `${base}/warehouse` },
    { label: "Przerób", value: snapshot.progressEntries, detail: "pozycje wykonania i odbioru", icon: TrendingUp, href: `${base}/progress` },
    { label: "Dowody", value: `${evidencePercent}%`, detail: `${snapshot.evidenceComplete}/${snapshot.evidenceRequired} kompletnych`, icon: ShieldCheck, href: `${base}/closeout` }
  ];
  return (
    <div className="execution-center">
      <section className="execution-flow" aria-label="Pion kosztorys do odbioru">
        {stages.map(({ icon: Icon, ...stage }, index) => (
          <Link href={stage.href} key={stage.label} className="execution-stage">
            <span><Icon size={19} /></span><small>Etap {index + 1}</small><strong>{stage.label}</strong><b>{stage.value}</b><p>{stage.detail}</p><ArrowRight size={15} />
          </Link>
        ))}
      </section>

      <section className="control-dashboard-grid">
        <article className="module-panel">
          <div className="module-panel__heading"><GitCompareArrows size={19} /><div><p className="eyebrow">Radar skutków zmiany</p><h2>{snapshot.changeImpacts} decyzji</h2></div></div>
          <p>Nowa rewizja dokumentu może wskazać wpływ na BOQ, termin, materiały, wnioski i protokoły. Zmiany pozostają propozycją do zatwierdzenia w Skrzynce AI.</p>
          <Link href={`/workspace/companies/${workspaceId}/ai-inbox`} className="text-link">Otwórz decyzje <ArrowRight size={15} /></Link>
        </article>
        <article className="module-panel module-panel--ai">
          <div className="module-panel__heading"><TrendingUp size={19} /><div><p className="eyebrow">Prognoza końca kontraktu</p><h2>{snapshot.latestForecast ? "Aktualna prognoza" : "Brak prognozy"}</h2></div></div>
          {financeAllowed ? <>
            {snapshot.latestForecast ? <p>EAC: {new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(snapshot.latestForecast.estimate_at_completion)} · termin: {snapshot.latestForecast.forecast_finish_date ?? "do wyliczenia"}.</p> : <p>Prognoza rozdzieli koszt rzeczywisty, zaangażowanie, koszt do zakończenia i założenia.</p>}
            {canManageFinance ? <OperationsActionButton projectId={projectId} action="create_forecast" label="Przelicz forecast" /> : <small>Dostęp tylko do odczytu.</small>}
          </> : <div className="pw-protected-data"><LockKeyhole size={20} /><div><strong>Dane finansowe są ukryte</strong><p>Wymagana jest rola Finanse dla tej inwestycji.</p></div></div>}
        </article>
        <article className="module-panel">
          <div className="module-panel__heading"><ShieldCheck size={19} /><div><p className="eyebrow">Paczka zamknięcia</p><h2>{closeoutPercent}% kompletności</h2></div></div>
          <p>{snapshot.closeoutComplete} z {snapshot.closeoutRequired} wymaganych pozycji ma status kompletny. Lista obejmuje rewizje, deklaracje, próby, protokoły, zdjęcia, gwarancje i spis przekazania.</p>
          {canManageInvestments ? <OperationsActionButton projectId={projectId} action="initialize_closeout" label="Aktualizuj checklistę" /> : <small>Dostęp tylko do odczytu.</small>}
        </article>
        <article className="module-panel">
          <div className="module-panel__heading"><PackageCheck size={19} /><div><p className="eyebrow">Mobilna budowa</p><h2>{snapshot.siteEvents} zdarzeń</h2></div></div>
          <p>Zdjęcie, notatka, dostawa, obmiar i odbiór są przypinane do inwestycji oraz WBS, a szkic wymaga decyzji kierownika.</p>
          <Link href={`${base}/site`} className="text-link">Dodaj zdarzenie <ArrowRight size={15} /></Link>
        </article>
      </section>
    </div>
  );
}
