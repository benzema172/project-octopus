import Link from "next/link";
import { Bot, ChevronRight, CircleAlert, Sparkles } from "lucide-react";
import type { InvestmentAutopilotSummary } from "@/lib/data/investment-autopilot";
import styles from "./investment-autopilot.module.css";

export function ProjectAutopilotDock({ projectId, summary, canRun }: { projectId: string; summary: InvestmentAutopilotSummary; canRun: boolean }) {
  const tone = summary.healthScore >= 80 ? styles.dockGood : summary.healthScore >= 55 ? styles.dockWarn : styles.dockRisk;
  return <section className={`${styles.dock} ${tone}`} aria-label="Investment Autopilot">
    <div className={styles.dockBrand}><span><Bot size={17} /></span><div><small>Investment Autopilot</small><strong>Octopus prowadzi stan inwestycji</strong></div></div>
    <div className={styles.dockMetric}><b>{summary.healthScore}</b><span>Project Health</span></div>
    <div className={styles.dockMetric}><b>{summary.attentionCount}</b><span>wymaga uwagi</span></div>
    <div className={styles.dockMetric}><b>{summary.aiCanDoCount}</b><span>AI może przygotować</span></div>
    <div className={styles.dockNext}>{summary.blockerCount ? <CircleAlert size={15} /> : <Sparkles size={15} />}<span><small>Następny krok</small><strong>{summary.nextTitle ?? "Brak pilnych czynności"}</strong></span></div>
    <Link href={`/workspace/projects/${projectId}/control#autopilot`} className={styles.dockLink}>Centrum <ChevronRight size={15} /></Link>
    {canRun ? <span className={styles.dockAuto}>AUTO</span> : null}
  </section>;
}
