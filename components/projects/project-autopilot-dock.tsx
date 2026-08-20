import Link from "next/link";
import { Bot, ChevronRight, CircleAlert, ShieldCheck, Sparkles } from "lucide-react";
import type { InvestmentAutopilotSummary } from "@/lib/data/investment-autopilot";
import styles from "./investment-autopilot.module.css";

export function ProjectAutopilotDock({ projectId, summary, canRun }: { projectId: string; summary: InvestmentAutopilotSummary; canRun: boolean }) {
  const state = summary.blockerCount > 0 || summary.healthScore < 55 ? "risk" : summary.attentionCount > 0 || summary.healthScore < 80 ? "attention" : "stable";
  const tone = state === "stable" ? styles.dockGood : state === "attention" ? styles.dockWarn : styles.dockRisk;
  const stateLabel = state === "stable" ? "Stabilna" : state === "attention" ? "Wymaga uwagi" : "Ryzyko";
  const statusText = summary.blockerCount > 0
    ? `${summary.blockerCount} ${summary.blockerCount === 1 ? "blokada wymaga" : "blokady wymagają"} reakcji`
    : summary.attentionCount > 0
      ? `${summary.attentionCount} ${summary.attentionCount === 1 ? "sprawa wymaga" : "spraw wymaga"} weryfikacji`
      : "Brak otwartych blokad i pilnych sygnałów";
  const nextTitle = summary.nextTitle ?? "Brak pilnych czynności";

  return <section className={`${styles.dock} ${tone}`} aria-label="Investment Autopilot">
    <div className={styles.dockOverview}>
      <div className={styles.dockBrand}>
        <span className={styles.dockBot}><Bot size={18} /></span>
        <div className={styles.dockBrandText}>
          <small>Investment Autopilot</small>
          <div className={styles.dockStateLine}>
            <strong>Stan inwestycji</strong>
            <span className={styles.dockState} data-state={state}>{stateLabel}</span>
          </div>
          <p>{statusText}</p>
        </div>
      </div>
      <Link href={`/workspace/projects/${projectId}/control#autopilot`} className={styles.dockCenterLink}>Centrum <ChevronRight size={14} /></Link>
    </div>

    <div className={styles.dockHealth} aria-label={`Project Health ${summary.healthScore} na 100`}>
      <div className={styles.dockHealthRing} style={{ "--health": `${summary.healthScore * 3.6}deg` } as React.CSSProperties}>
        <span><b>{summary.healthScore}</b><small>/100</small></span>
      </div>
      <div><small>Project Health</small><strong>{stateLabel}</strong></div>
    </div>

    <div className={styles.dockSignals} aria-label="Sygnały operacyjne">
      <div className={styles.dockSignal} data-kind={summary.attentionCount ? "attention" : "clear"}>
        <span>{summary.attentionCount ? <CircleAlert size={15} /> : <ShieldCheck size={15} />}</span>
        <div><b>{summary.attentionCount}</b><small>do uwagi</small></div>
      </div>
      <div className={styles.dockSignal} data-kind={summary.blockerCount ? "risk" : "clear"}>
        <span>{summary.blockerCount ? <CircleAlert size={15} /> : <ShieldCheck size={15} />}</span>
        <div><b>{summary.blockerCount}</b><small>blokad</small></div>
      </div>
      <div className={styles.dockSignal} data-kind="ai">
        <span><Sparkles size={15} /></span>
        <div><b>{summary.aiCanDoCount}</b><small>AI może zrobić</small></div>
      </div>
    </div>

    <div className={styles.dockNext}>
      <span className={styles.dockNextIcon}>{summary.blockerCount ? <CircleAlert size={17} /> : <Sparkles size={17} />}</span>
      <div className={styles.dockNextText}>
        <small>{summary.nextTitle ? "Rekomendowany następny krok" : "Aktualny priorytet"}</small>
        <strong>{nextTitle}</strong>
        <span>{summary.nextTitle ? "Autopilot wybrał tę czynność na podstawie aktualnych danych projektu." : "Dane nie wskazują teraz czynności wymagającej natychmiastowej reakcji."}</span>
      </div>
      <Link href={`/workspace/projects/${projectId}/control#autopilot`} className={styles.dockNextAction} aria-label="Otwórz Centrum Autopilota"><ChevronRight size={17} /></Link>
    </div>

    {canRun ? <span className={styles.dockAuto}>AUTO</span> : null}
  </section>;
}
