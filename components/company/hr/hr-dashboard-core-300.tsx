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
function issueLabel(kind: string) {
  if (kind === "medical") return "Badanie lekarskie";
  if (kind === "safety") return "BHP";
  if (kind === "contract") return "Umowa";
  if (kind === "timesheet") return "Czas pracy";
  if (kind === "leave") return "Urlopy";
  if (kind === "qualification") return "Uprawnienia";
  if (kind === "allocation") return "Obłożenie";
  if (kind === "employment") return "Zatrudnienie";
  if (kind === "cost") return "Koszt pracy";
  if (kind === "document") return "Dokument AI";
  return "Sprawa";
}
function issueCountLabel(count: number) {
  if (count === 1) return "1 sprawa wymaga uwagi";
  if (count >= 2 && count <= 4) return `${count} sprawy wymagają uwagi`;
  return `${count} spraw wymaga uwagi`;
}

export function HrDashboardCore300({ data, canViewPayroll, onNavigate }: { data: HrWorkspaceData; canViewPayroll: boolean; onNavigate: (tab: HrWorkspaceTab, employeeId?: string) => void }) {
  const issueSummary = buildHrEmployeeIssues(data, { canViewPayroll });
  const groupedIssues = Array.from(issueSummary.byEmployee.entries()).map(([employeeId, issues]) => ({
    employeeId,
    employeeName: issues[0]?.employeeName ?? "Pracownik",
    issues,
    severity: issues.some((issue) => issue.severity === "critical") ? "critical" : issues.some((issue) => issue.severity === "warning") ? "warning" : "info"
  })).slice(0, 12);
  const severityIcon = (severity: string) => severity === "critical" ? <CircleAlert size={17} /> : severity === "warning" ? <AlertTriangle size={17} /> : <Info size={17} />;

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
        <div className={styles.employeeIssueGroups}>
          {groupedIssues.map((group) => <article key={group.employeeId} className={`${styles.employeeIssueGroup} ${styles[`employeeIssueGroup${group.severity[0].toUpperCase()}${group.severity.slice(1)}`]}`}>
            <div className={styles.groupLead}>
              <span className={styles.groupIcon}>{severityIcon(group.severity)}</span>
              <span><strong>{group.employeeName}</strong><small>{issueCountLabel(group.issues.length)}</small></span>
            </div>
            <div className={styles.groupChips}>
              {group.issues.slice(0, 6).map((issue) => <button type="button" key={issue.id} className={`${styles.issueChip} ${styles[`issueChip${issue.severity[0].toUpperCase()}${issue.severity.slice(1)}`]}`} title={`${issue.title} — ${issue.detail}`} onClick={() => onNavigate(issue.targetTab, issue.employeeId)}>{issueLabel(issue.kind)}</button>)}
              {group.issues.length > 6 ? <span className={styles.moreIssues}>+{group.issues.length - 6}</span> : null}
            </div>
            <button type="button" className={styles.groupAction} onClick={() => onNavigate(group.issues[0]?.targetTab ?? "employees", group.employeeId)}>Szczegóły <ArrowRight size={13} /></button>
          </article>)}
          {!groupedIssues.length ? <div className={styles.empty}><CircleCheck size={18} /> Brak aktywnych problemów kadrowych.</div> : null}
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
