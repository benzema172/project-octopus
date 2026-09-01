"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BriefcaseBusiness, Clock3, Coins, Gauge, Plus, UsersRound } from "lucide-react";
import { calculateLaborControl, type HrLaborRow } from "@/lib/hr/labor-cost-control";
import styles from "./hr-team-cost-control-156.module.css";

type Row = Record<string, unknown>;

type Props = {
  workspaceId: string;
  data: {
    referenceDate: string;
    employees: Row[];
    projects: Row[];
    employments: Row[];
    assignments: Row[];
    timesheets: Row[];
    teams: Row[];
    teamMembers: Row[];
    complianceItems: Row[];
  };
  canWrite: boolean;
  canViewPayroll: boolean;
};

type Scope = "all" | "pending" | "unassigned" | "overplan";

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function employeeName(row?: Row) {
  return row ? `${text(row.first_name, "")} ${text(row.last_name, "")}`.trim() || text(row.employee_number) : "Pracownik";
}

function number(value: unknown, digits = 1) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0);
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number.isFinite(parsed) ? parsed : 0);
}

function riskLabel(value: "expired" | "expiring" | null) {
  if (value === "expired") return "Wygasłe BHP / badania";
  if (value === "expiring") return "Termin ≤30 dni";
  return null;
}

export function HrTeamCostControl156({ workspaceId, data, canWrite, canViewPayroll }: Props) {
  const router = useRouter();
  const [month, setMonth] = useState(data.referenceDate.slice(0, 7));
  const [scope, setScope] = useState<Scope>("all");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const employeeById = useMemo(() => new Map(data.employees.map((row) => [String(row.id), row])), [data.employees]);
  const projectById = useMemo(() => new Map(data.projects.map((row) => [String(row.id), row])), [data.projects]);
  const teamsByProject = useMemo(() => {
    const result = new Map<string, Row[]>();
    for (const team of data.teams.filter((row) => row.active !== false && row.project_id)) {
      const projectId = String(team.project_id);
      result.set(projectId, [...(result.get(projectId) ?? []), team]);
    }
    return result;
  }, [data.teams]);

  const control = useMemo(() => calculateLaborControl({
    month,
    referenceDate: data.referenceDate,
    projects: data.projects as HrLaborRow[],
    employments: data.employments as HrLaborRow[],
    assignments: data.assignments as HrLaborRow[],
    timesheets: data.timesheets as HrLaborRow[],
    complianceItems: data.complianceItems as HrLaborRow[]
  }), [data.assignments, data.complianceItems, data.employments, data.projects, data.referenceDate, data.timesheets, month]);

  const visibleProjects = scope === "overplan"
    ? control.projects.filter((row) => row.overPlan || row.projectedOverPlan)
    : scope === "pending"
      ? control.projects.filter((row) => row.pendingHours > 0 || row.pendingCost > 0)
      : control.projects;
  const shownProjectIds = new Set(visibleProjects.map((row) => row.projectId));

  const submitAssignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    setFeedback(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/hr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, action: "assignment_create", payload })
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Nie udało się przypisać pracownika do inwestycji.");
        form.reset();
        setFeedback("Formalne przypisanie zapisano. Plan godzin i kosztu przeliczy się automatycznie.");
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Nie udało się przypisać pracownika do inwestycji.");
      }
    });
  };

  return <section className={styles.control} data-hr-labor-cost-control="2">
    <div className={styles.heading}>
      <div>
        <p className={styles.kicker}>Kontrola robocizny</p>
        <h2>Zespoły, godziny i koszt inwestycji</h2>
        <p>Plan powstaje z formalnych przypisań. Wpisy oczekujące pokazują koszt prognozowany, a dopiero zatwierdzony czas tworzy koszt rzeczywisty dla Finansów i KPI inwestycji.</p>
      </div>
      <label className={styles.monthField}>Miesiąc<input type="month" value={month} onChange={(event) => setMonth(event.target.value || data.referenceDate.slice(0, 7))} /></label>
    </div>

    <div className={styles.kpis}>
      <button type="button" className={`${styles.kpi} ${scope === "all" ? styles.kpiActive : ""}`} onClick={() => setScope("all")}>
        <Coins size={18} /><span>Koszt zatwierdzony</span><strong>{canViewPayroll ? money(control.actualCost) : "••••"}</strong><small>{number(control.approvedHours)} h zatwierdzonego czasu</small>
      </button>
      <button type="button" className={`${styles.kpi} ${scope === "pending" ? styles.kpiActive : ""}`} onClick={() => setScope(scope === "pending" ? "all" : "pending")}>
        <Clock3 size={18} /><span>Do zatwierdzenia</span><strong>{canViewPayroll ? money(control.pendingCost) : `${number(control.pendingHours)} h`}</strong><small>{number(control.pendingHours)} h · po akceptacji trafi do kosztu rzeczywistego</small>
      </button>
      <button type="button" className={styles.kpi} onClick={() => setScope("all")}>
        <Gauge size={18} /><span>Plan robocizny</span><strong>{canViewPayroll ? money(control.plannedCost) : `${number(control.plannedHours)} h`}</strong><small>{number(control.plannedHours)} h z formalnych przypisań</small>
      </button>
      <button type="button" className={`${styles.kpi} ${scope === "unassigned" ? styles.kpiActive : ""}`} onClick={() => setScope(scope === "unassigned" ? "all" : "unassigned")}>
        <BriefcaseBusiness size={18} /><span>Bez inwestycji</span><strong>{canViewPayroll ? money(control.unassignedActualCost + control.unassignedPendingCost) : `${number(control.unassignedApprovedHours + control.unassignedPendingHours)} h`}</strong><small>{number(control.unassignedApprovedHours + control.unassignedPendingHours)} h bez kontraktu</small>
      </button>
      <button type="button" className={`${styles.kpi} ${scope === "overplan" ? styles.kpiActive : ""}`} onClick={() => setScope(scope === "overplan" ? "all" : "overplan")}>
        <Gauge size={18} /><span>Plan zagrożony</span><strong>{control.projectedOverPlanProjects}</strong><small>{control.overPlanProjects} już przekroczonych po zatwierdzeniu</small>
      </button>
    </div>

    {control.withoutFormalAssignmentPeople > 0 ? <div className={`${styles.feedback} ${styles.feedbackWarn}`}>
      <AlertTriangle size={15} />
      <span><strong>{control.withoutFormalAssignmentPeople}</strong> {control.withoutFormalAssignmentPeople === 1 ? "osoba ma" : "osoby mają"} czas wpisany na inwestycję, ale brak formalnego przypisania. Czas jest widoczny poniżej, lecz bez przypisania nie powstanie miesięczny plan kosztu.</span>
    </div> : null}
    {control.assignedWithoutTimePeople > 0 ? <div className={styles.feedbackMuted}>
      <UsersRound size={15} /><span><strong>{control.assignedWithoutTimePeople}</strong> {control.assignedWithoutTimePeople === 1 ? "osoba jest przypisana" : "osoby są przypisane"}, ale nie ma jeszcze ewidencji czasu w tym miesiącu.</span>
    </div> : null}
    {feedback ? <div className={styles.feedback}>{feedback}</div> : null}
    {error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{error}</div> : null}

    {canWrite ? <details className={styles.quickAssign}>
      <summary><Plus size={15} /> Szybkie formalne przypisanie pracownika do inwestycji</summary>
      <form onSubmit={submitAssignment}>
        <label>Pracownik<select name="employeeId" required defaultValue=""><option value="">Wybierz</option>{data.employees.filter((row) => row.status === "active").map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label>
        <label>Inwestycja<select name="projectId" required defaultValue=""><option value="">Wybierz</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label>
        <label>Rola<input name="role" placeholder="Monter / brygadzista" required /></label>
        <label>Zaangażowanie %<input name="allocationPercent" inputMode="decimal" defaultValue="100" /></label>
        <label>Od<input name="dateFrom" type="date" defaultValue={data.referenceDate} /></label>
        <label>Do<input name="dateTo" type="date" /></label>
        <button disabled={pending}>{pending ? "Przypisywanie…" : "Przypisz"}</button>
      </form>
      <p className={styles.assignHint}>Formalne przypisanie określa obłożenie i buduje plan miesiąca. Sam wybór inwestycji we wpisie czasu mówi tylko, gdzie wykonano konkretne godziny.</p>
    </details> : null}

    {scope === "unassigned" ? <article className={styles.unassignedCard}>
      <div><p className={styles.kicker}>Koszt ogólny firmy</p><h3>Godziny bez wskazanej inwestycji</h3><p>Te wpisy nie obciążają żadnego kontraktu. Po poprawieniu ewidencji koszt automatycznie trafi do właściwej inwestycji.</p></div>
      <div className={styles.unassignedNumbers}><span><small>Zatwierdzone</small><strong>{number(control.unassignedApprovedHours)} h</strong></span><span><small>Koszt zatwierdzony</small><strong>{canViewPayroll ? money(control.unassignedActualCost) : "••••"}</strong></span><span><small>Oczekujące</small><strong>{number(control.unassignedPendingHours)} h</strong></span><span><small>Koszt oczekujący</small><strong>{canViewPayroll ? money(control.unassignedPendingCost) : "••••"}</strong></span></div>
    </article> : null}

    {scope !== "unassigned" ? <div className={styles.projectList}>
      {visibleProjects.map((projectCost) => {
        const project = projectById.get(projectCost.projectId);
        const teamNames = (teamsByProject.get(projectCost.projectId) ?? []).map((row) => text(row.name)).join(" · ");
        const ratio = projectCost.plannedCost > 0 ? Math.min(160, projectCost.projectedCost / projectCost.plannedCost * 100) : projectCost.projectedCost > 0 ? 160 : 0;
        return <details className={`${styles.projectCard} ${projectCost.overPlan ? styles.projectOver : projectCost.projectedOverPlan ? styles.projectRisk : ""}`} key={projectCost.projectId}>
          <summary>
            <div className={styles.projectIdentity}><UsersRound size={18} /><div><strong>{text(project?.name, "Inwestycja")}</strong><span>{projectCost.people} osób · {projectCost.formalAssignmentPeople} formalnie przypisanych{projectCost.withoutFormalAssignmentPeople ? ` · ${projectCost.withoutFormalAssignmentPeople} bez planu` : ""}{teamNames ? ` · ${teamNames}` : ""}</span></div></div>
            <div className={styles.projectMetric}><small>Zatwierdzone</small><strong>{number(projectCost.approvedHours + projectCost.overtimeHours)} h</strong></div>
            <div className={styles.projectMetric}><small>Koszt zatwierdzony</small><strong>{canViewPayroll ? money(projectCost.actualCost) : "••••"}</strong></div>
            <div className={`${styles.projectMetric} ${projectCost.pendingHours > 0 ? styles.projectMetricPending : ""}`}><small>Do zatwierdzenia</small><strong>{canViewPayroll ? money(projectCost.pendingCost) : `${number(projectCost.pendingHours)} h`}</strong><em>{number(projectCost.pendingHours)} h</em></div>
            <div className={styles.projectMetric}><small>Plan</small><strong>{canViewPayroll ? money(projectCost.plannedCost) : `${number(projectCost.plannedHours)} h`}</strong></div>
            <div className={`${styles.delta} ${projectCost.overPlan ? styles.deltaBad : projectCost.projectedOverPlan ? styles.deltaWarn : styles.deltaOk}`}>{projectCost.plannedCost > 0 && canViewPayroll ? `${projectCost.projectedCost > projectCost.plannedCost ? "+" : ""}${money(projectCost.projectedCost - projectCost.plannedCost)}` : projectCost.withoutFormalAssignmentPeople ? "Brak planu" : "—"}</div>
          </summary>
          <div className={styles.projectBody}>
            <div className={styles.progress} aria-label="Prognozowana realizacja planu kosztu"><span style={{ width: `${Math.min(100, ratio)}%` }} /><i>{number(ratio, 0)}%</i></div>
            {projectCost.warnings.length ? <div className={styles.warnings}>{projectCost.warnings.map((warning) => <span key={warning}><AlertTriangle size={13} /> {warning}</span>)}</div> : <div className={styles.okLine}>Brak ostrzeżeń dla tej inwestycji.</div>}
            <div className={styles.tableWrap}><table><thead><tr><th>Pracownik</th><th>Alokacja</th><th>Plan h</th><th>Zatwierdzone</th><th>Nadgodziny</th><th>Koszt/h</th><th>Koszt zatw.</th><th>Do zatwierdzenia</th><th>Kontrola</th></tr></thead><tbody>
              {projectCost.employeeCosts.map((employeeCost) => {
                const employee = employeeById.get(employeeCost.employeeId);
                const risk = riskLabel(employeeCost.complianceRisk);
                const overHours = employeeCost.plannedHours > 0 && employeeCost.approvedHours + employeeCost.overtimeHours > employeeCost.plannedHours + 0.1;
                const hasAnyTime = employeeCost.approvedHours + employeeCost.overtimeHours + employeeCost.pendingHours > 0;
                return <tr key={employeeCost.employeeId}>
                  <td><strong>{employeeName(employee)}</strong></td>
                  <td>{employeeCost.hasAssignment ? `${number(employeeCost.allocationPercent, 0)}%` : <span className={styles.badText}>brak planu</span>}</td>
                  <td>{number(employeeCost.plannedHours)} h</td>
                  <td>{number(employeeCost.approvedHours)} h</td>
                  <td>{number(employeeCost.overtimeHours)} h</td>
                  <td>{canViewPayroll ? (employeeCost.hourlyCost > 0 ? money(employeeCost.hourlyCost) : <span className={styles.badText}>brak</span>) : "••••"}</td>
                  <td><strong>{canViewPayroll ? money(employeeCost.actualCost) : "••••"}</strong></td>
                  <td>{number(employeeCost.pendingHours)} h{canViewPayroll && employeeCost.pendingCost > 0 ? <small className={styles.pendingCost}>{money(employeeCost.pendingCost)}</small> : null}</td>
                  <td><div className={styles.controlFlags}>{!employeeCost.hasAssignment && hasAnyTime ? <span className={styles.flagBad}>Brak formalnego przypisania</span> : null}{employeeCost.hasAssignment && !hasAnyTime ? <span className={styles.flagWarn}>Brak ewidencji czasu</span> : null}{overHours ? <span className={styles.flagWarn}>Ponad plan h</span> : null}{risk ? <span className={employeeCost.complianceRisk === "expired" ? styles.flagBad : styles.flagWarn}>{risk}</span> : null}{employeeCost.hourlyCost <= 0 && canViewPayroll ? <span className={styles.flagBad}>Brak kosztu/h</span> : null}{employeeCost.hasAssignment && hasAnyTime && !overHours && !risk && (employeeCost.hourlyCost > 0 || !canViewPayroll) ? <span className={styles.flagOk}>OK</span> : null}</div></td>
                </tr>;
              })}
            </tbody></table></div>
            <div className={styles.projectFooter}>
              <span>Plan: <strong>{number(projectCost.plannedHours)} h</strong>{canViewPayroll ? ` · ${money(projectCost.plannedCost)}` : ""}</span>
              <span>Zatwierdzone: <strong>{number(projectCost.approvedHours + projectCost.overtimeHours)} h</strong>{canViewPayroll ? ` · ${money(projectCost.actualCost)}` : ""}</span>
              <span>Do zatwierdzenia: <strong>{number(projectCost.pendingHours)} h</strong>{canViewPayroll ? ` · ${money(projectCost.pendingCost)}` : ""}</span>
              <span>Prognoza po akceptacji: <strong>{number(projectCost.projectedHours)} h</strong>{canViewPayroll ? ` · ${money(projectCost.projectedCost)}` : ""}</span>
            </div>
          </div>
        </details>;
      })}
      {!visibleProjects.length ? <div className={styles.empty}>{scope === "overplan" ? "Brak inwestycji z przekroczonym lub zagrożonym planem robocizny." : scope === "pending" ? "Brak oczekujących kosztów robocizny dla inwestycji." : "Brak przypisań i czasu pracy dla inwestycji w wybranym miesiącu."}</div> : null}
    </div> : null}

    {scope === "all" && control.unassignedApprovedHours + control.unassignedPendingHours > 0 ? <button type="button" className={styles.unassignedNotice} onClick={() => setScope("unassigned")}><AlertTriangle size={15} /><span><strong>{number(control.unassignedApprovedHours + control.unassignedPendingHours)} h</strong> czasu nie ma wskazanej inwestycji.</span><span>Sprawdź →</span></button> : null}

    <p className={styles.sourceNote}>Zasada kosztu: wpisy oczekujące są prognozą, a koszt rzeczywisty powstaje dopiero po zatwierdzeniu czasu. Przy modelu miesięcznym koszt/h wynika z pełnego kosztu pracodawcy i nominalnych godzin; przy modelu „godzinowo + podstawa” inwestycje są liczone według zapisanej stawki operacyjnej/h. Formalne przypisanie buduje plan, ale samo nie księguje kosztu rzeczywistego.</p>
  </section>;
}
