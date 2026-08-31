"use client";

import { AlertTriangle, ArrowRight, CircleAlert, CircleCheck, Info, UsersRound } from "lucide-react";
import { buildHrEmployeeIssues } from "@/lib/hr/employee-issues";
import type { HrWorkspaceData, HrWorkspaceTab } from "@/lib/hr/types";
import styles from "./hr-core-300.module.css";

function num(value: unknown, digits = 0) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0);
}
function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number.isFinite(parsed) ? parsed : 0);
}
function str(value: unknown, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }

export function HrDashboardCore300({ data, canViewPayroll, onNavigate }: { data: HrWorkspaceData; canViewPayroll: boolean; onNavigate: (tab: HrWorkspaceTab, employeeId?: string) => void }) {
  const issueSummary = buildHrEmployeeIssues(data, { canViewPayroll });
  const topIssues = issueSummary.issues.slice(0, 30);
  const severityIcon = (severity: string) => severity === "critical" ? <CircleAlert size={16} /> : severity === "warning" ? <AlertTriangle size={16} /> : <Info size={16} />;

  return <div className={styles.dashboard} data-hr-core-dashboard="300">
    <section className={styles.kpis}>
      <article className={styles.kpi}><small>Aktywni</small><strong>{num(data.summary.activeEmployees)}</strong><span>pracowników</span></article>
      <article className={styles.kpi}><small>Na inwestycjach</small><strong>{num(data.summary.todayOnSites)}</strong><span>dzisiaj bez absencji</span></article>
      <article className={styles.kpi}><small>Problemy krytyczne</small><strong>{issueSummary.critical}</strong><span>{issueSummary.affectedEmployees} osób z uwagami</span></article>
      <article className={styles.kpi}><small>Terminy ≤30 dni</small><strong>{num(data.summary.expiring30)}</strong><span>{num(data.summary.expired)} po terminie</span></article>
      <article className={styles.kpi}><small>Do decyzji</small><strong>{num(data.summary.pendingDecisions)}</strong><span>urlopy + czas pracy</span></article>
      <article className={styles.kpi}><small>Bez inwestycji</small><strong>{num(data.summary.unassigned)}</strong><span>aktywnych osób</span></article>
    </section>

    <section className={styles.grid}>
      <article className={styles.panel}>
        <header className={styles.panelHeader}><div><p className={styles.kicker}>Centrum problemów pracownika</p><h2>Co wymaga działania</h2></div><span className={styles.badge}>{issueSummary.issues.length} spraw</span></header>
        <div className={styles.issueList}>
          {topIssues.map((issue) => <button type="button" key={issue.id} className={`${styles.issue} ${styles[issue.severity]}`} onClick={() => onNavigate(issue.targetTab, issue.employeeId)}>
            {severityIcon(issue.severity)}
            <span><strong>{issue.title}</strong><small>{issue.detail}</small></span>
            <span className={styles.employee}>{issue.employeeName} <ArrowRight size={12} /></span>
          </button>)}
          {!topIssues.length ? <div className={styles.empty}><CircleCheck size={18} /> Brak aktywnych problemów kadrowych.</div> : null}
        </div>
      </article>

      <article className={styles.panel}>
        <header className={styles.panelHeader}><div><p className={styles.kicker}>Zasoby</p><h3>Zespół na inwestycjach</h3></div><UsersRound size={19} /></header>
        <div className={styles.projects}>{data.projectStaff.slice(0, 12).map((row) => <div className={styles.project} key={String(row.project_id)}><div><strong>{str(row.name)}</strong><span>{num(row.people)} osób</span></div><strong>{num(row.allocation)}%</strong></div>)}</div>
        {!data.projectStaff.length ? <div className={styles.empty}>Brak aktywnych przypisań.</div> : null}
      </article>
    </section>

    {canViewPayroll ? <section className={styles.panel} data-hr-core-payroll-summary="1">
      <header className={styles.panelHeader}><div><p className={styles.kicker}>Koszt zatrudnienia</p><h3>Bieżący miesiąc</h3></div><span className={styles.badge}>{num(data.summary.payrollConfirmed)}/{num(data.summary.activeEmployees)} potwierdzonych</span></header>
      <div className={styles.moneyGrid}>
        <div className={styles.moneyCard}><small>Do wypłaty netto</small><strong>{money(data.summary.monthlyNetPay)}</strong></div>
        <div className={styles.moneyCard}><small>Pełny koszt pracodawcy</small><strong>{money(data.summary.monthlyEmploymentCost)}</strong></div>
        <div className={styles.moneyCard}><small>Zatwierdzona robocizna</small><strong>{money(data.summary.approvedLaborCost)}</strong></div>
      </div>
    </section> : null}
  </div>;
}
