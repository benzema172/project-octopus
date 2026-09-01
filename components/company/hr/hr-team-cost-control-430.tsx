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

type Scope = "all" | "unassigned" | "overplan";

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

export function HrTeamCostControl430({ workspaceId, data, canWrite, canViewPayroll }: Props) {
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
    ? control.projects.filter((row) => row.overPlan)
    : control.projects;

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
        if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać planu pracownika.");
        form.reset();
        setFeedback("Plan zespołu zapisano. Rzeczywisty koszt powstaje automatycznie z dziennej ewidencji pracy.");
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Nie udało się zapisać planu pracownika.");
      }
    });
  };

  return <section className={styles.control} data-hr-labor-cost-control="430" data-auto-labor-cost="1">
    <div className={styles.heading}>
      <div>
        <p className={styles.kicker}>Kontrola robocizny</p>
        <h2>Zespoły, godziny i koszt inwestycji</h2>
        <p>Wskazanie inwestycji w dziennej ewidencji od razu zapisuje roboczogodziny i koszt rzeczywisty. Nie ma dodatkowego zatwierdzania. Formalne przypisania poniżej służą wyłącznie do planowania zespołu.</p>
      </div>
      <label className={styles.monthField}>Miesiąc<input type="month" value={month} onChange={(event) => setMonth(event.target.value || data.referenceDate.slice(0, 7))} /></label>
    </div>

    <div className={styles.kpis}>
      <button type="button" className={`${styles.kpi} ${scope === "all" ? styles.kpiActive : ""}`} onClick={() => setScope("all")}>
        <Coins size={18} /><span>Koszt rzeczywisty</span><strong>{canViewPayroll ? money(control.actualCost) : "••••"}</strong><small>{number(control.approvedHours)} h zapisanej pracy na inwestycjach</small>
      </button>
      <button type="button" className={styles.kpi} onClick={() => setScope("all")}>
        <Clock3 size={18} /><span>Roboczogodziny</span><strong>{number(control.approvedHours)} h</strong><small>w tym {number(control.overtimeHours)} h nadgodzin</small>
      </button>
      <button type="button" className={styles.kpi} onClick={() => setScope("all")}>
        <Gauge size={18} /><span>Plan robocizny</span><strong>{canViewPayroll ? money(control.plannedCost) : `${number(control.plannedHours)} h`}</strong><small>{number(control.plannedHours)} h z planowanych przypisań</small>
      </button>
      <button type="button" className={`${styles.kpi} ${scope === "unassigned" ? styles.kpiActive : ""}`} onClick={() => setScope(scope === "unassigned" ? "all" : "unassigned")}>
        <BriefcaseBusiness size={18} /><span>Bez inwestycji</span><strong>{canViewPayroll ? money(control.unassignedActualCost) : `${number(control.unassignedApprovedHours)} h`}</strong><small>{number(control.unassignedApprovedHours)} h kosztu ogólnego</small>
      </button>
      <button type="button" className={`${styles.kpi} ${scope === "overplan" ? styles.kpiActive : ""}`} onClick={() => setScope(scope === "overplan" ? "all" : "overplan")}>
        <Gauge size={18} /><span>Przekroczony plan</span><strong>{control.overPlanProjects}</strong><small>inwestycji powyżej planu kosztu</small>
      </button>
    </div>

    {control.withoutFormalAssignmentPeople > 0 ? <div className={`${styles.feedback} ${styles.feedbackWarn}`}>
      <AlertTriangle size={15} />
      <span><strong>{control.withoutFormalAssignmentPeople}</strong> {control.withoutFormalAssignmentPeople === 1 ? "osoba ma" : "osoby mają"} rzeczywisty czas na inwestycji bez planowanego przypisania. Koszt jest liczony normalnie; brak przypisania wpływa tylko na porównanie z planem.</span>
    </div> : null}
    {control.assignedWithoutTimePeople > 0 ? <div className={styles.feedbackMuted}>
      <UsersRound size={15} /><span><strong>{control.assignedWithoutTimePeople}</strong> {control.assignedWithoutTimePeople === 1 ? "osoba jest w planie" : "osoby są w planie"}, ale nie ma jeszcze rzeczywistej ewidencji czasu w tym miesiącu.</span>
    </div> : null}
    {feedback ? <div className={styles.feedback}>{feedback}</div> : null}
    {error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{error}</div> : null}

    {canWrite ? <details className={styles.quickAssign}>
      <summary><Plus size={15} /> Plan zespołu / długoterminowe przypisanie</summary>
      <form onSubmit={submitAssignment}>
        <label>Pracownik<select name="employeeId" required defaultValue=""><option value="">Wybierz</option>{data.employees.filter((row) => row.status === "active").map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label>
        <label>Inwestycja<select name="projectId" required defaultValue=""><option value="">Wybierz</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label>
        <label>Rola<input name="role" placeholder="Monter / brygadzista" required /></label>
        <label>Zaangażowanie %<input name="allocationPercent" inputMode="decimal" defaultValue="100" /></label>
        <label>Od<input name="dateFrom" type="date" defaultValue={data.referenceDate} /></label>
        <label>Do<input name="dateTo" type="date" /></label>
        <button disabled={pending}>{pending ? "Zapisywanie…" : "Zapisz plan"}</button>
      </form>
      <p className={styles.assignHint}>To jest plan obłożenia pracownika. Nie tworzy sztucznego kosztu przyszłych dni. Rzeczywisty koszt powstaje w chwili wskazania inwestycji w dziennej ewidencji Czas pracy.</p>
    </details> : null}

    {scope === "unassigned" ? <article className={styles.unassignedCard}>
      <div><p className={styles.kicker}>Koszt ogólny firmy</p><h3>Godziny bez wskazanej inwestycji</h3><p>Te wpisy obciążają firmę, ale nie konkretny kontrakt. Zmiana inwestycji w ewidencji automatycznie przepnie cały koszt.</p></div>
      <div className={styles.unassignedNumbers}><span><small>Godziny</small><strong>{number(control.unassignedApprovedHours)} h</strong></span><span><small>Koszt</small><strong>{canViewPayroll ? money(control.unassignedActualCost) : "••••"}</strong></span></div>
    </article> : null}

    {scope !== "unassigned" ? <div className={styles.projectList}>
      {visibleProjects.map((projectCost) => {
        const project = projectById.get(projectCost.projectId);
        const teamNames = (teamsByProject.get(projectCost.projectId) ?? []).map((row) => text(row.name)).join(" · ");
        const ratio = projectCost.plannedCost > 0 ? Math.min(160, projectCost.actualCost / projectCost.plannedCost * 100) : projectCost.actualCost > 0 ? 160 : 0;
        return <details className={`${styles.projectCard} ${projectCost.overPlan ? styles.projectOver : ""}`} key={projectCost.projectId}>
          <summary>
            <div className={styles.projectIdentity}><UsersRound size={18} /><div><strong>{text(project?.name, "Inwestycja")}</strong><span>{projectCost.people} osób · {projectCost.formalAssignmentPeople} w planie{projectCost.withoutFormalAssignmentPeople ? ` · ${projectCost.withoutFormalAssignmentPeople} poza planem` : ""}{teamNames ? ` · ${teamNames}` : ""}</span></div></div>
            <div className={styles.projectMetric}><small>Godziny</small><strong>{number(projectCost.approvedHours + projectCost.overtimeHours)} h</strong></div>
            <div className={styles.projectMetric}><small>Koszt rzeczywisty</small><strong>{canViewPayroll ? money(projectCost.actualCost) : "••••"}</strong></div>
            <div className={styles.projectMetric}><small>Plan</small><strong>{canViewPayroll ? money(projectCost.plannedCost) : `${number(projectCost.plannedHours)} h`}</strong></div>
            <div className={`${styles.delta} ${projectCost.overPlan ? styles.deltaBad : styles.deltaOk}`}>{projectCost.plannedCost > 0 && canViewPayroll ? `${projectCost.actualCost > projectCost.plannedCost ? "+" : ""}${money(projectCost.actualCost - projectCost.plannedCost)}` : projectCost.withoutFormalAssignmentPeople ? "Brak planu" : "—"}</div>
          </summary>
          <div className={styles.projectBody}>
            <div className={styles.progress} aria-label="Realizacja planu kosztu"><span style={{ width: `${Math.min(100, ratio)}%` }} /><i>{number(ratio, 0)}%</i></div>
            {projectCost.warnings.length ? <div className={styles.warnings}>{projectCost.warnings.map((warning) => <span key={warning}><AlertTriangle size={13} /> {warning}</span>)}</div> : <div className={styles.okLine}>Brak ostrzeżeń dla tej inwestycji.</div>}
            <div className={styles.tableWrap}><table><thead><tr><th>Pracownik</th><th>Plan %</th><th>Plan h</th><th>Praca h</th><th>Nadgodziny</th><th>Koszt/h</th><th>Koszt rzeczywisty</th><th>Kontrola</th></tr></thead><tbody>
              {projectCost.employeeCosts.map((employeeCost) => {
                const employee = employeeById.get(employeeCost.employeeId);
                const risk = riskLabel(employeeCost.complianceRisk);
                const workedHours = employeeCost.approvedHours + employeeCost.overtimeHours;
                const overHours = employeeCost.plannedHours > 0 && workedHours > employeeCost.plannedHours + 0.1;
                const hasAnyTime = workedHours > 0;
                return <tr key={employeeCost.employeeId}>
                  <td><strong>{employeeName(employee)}</strong></td>
                  <td>{employeeCost.hasAssignment ? `${number(employeeCost.allocationPercent, 0)}%` : <span className={styles.badText}>brak planu</span>}</td>
                  <td>{number(employeeCost.plannedHours)} h</td>
                  <td>{number(employeeCost.approvedHours)} h</td>
                  <td>{number(employeeCost.overtimeHours)} h</td>
                  <td>{canViewPayroll ? (employeeCost.hourlyCost > 0 ? money(employeeCost.hourlyCost) : <span className={styles.badText}>brak</span>) : "••••"}</td>
                  <td><strong>{canViewPayroll ? money(employeeCost.actualCost) : "••••"}</strong></td>
                  <td><div className={styles.controlFlags}>{!employeeCost.hasAssignment && hasAnyTime ? <span className={styles.flagWarn}>Praca poza planem</span> : null}{employeeCost.hasAssignment && !hasAnyTime ? <span className={styles.flagWarn}>Brak ewidencji czasu</span> : null}{overHours ? <span className={styles.flagWarn}>Ponad plan h</span> : null}{risk ? <span className={employeeCost.complianceRisk === "expired" ? styles.flagBad : styles.flagWarn}>{risk}</span> : null}{employeeCost.hourlyCost <= 0 && canViewPayroll ? <span className={styles.flagBad}>Brak kosztu/h</span> : null}{hasAnyTime && !overHours && !risk && (employeeCost.hourlyCost > 0 || !canViewPayroll) ? <span className={styles.flagOk}>OK</span> : null}</div></td>
                </tr>;
              })}
            </tbody></table></div>
            <div className={styles.projectFooter}>
              <span>Plan: <strong>{number(projectCost.plannedHours)} h</strong>{canViewPayroll ? ` · ${money(projectCost.plannedCost)}` : ""}</span>
              <span>Rzeczywiście: <strong>{number(projectCost.approvedHours + projectCost.overtimeHours)} h</strong>{canViewPayroll ? ` · ${money(projectCost.actualCost)}` : ""}</span>
            </div>
          </div>
        </details>;
      })}
      {!visibleProjects.length ? <div className={styles.empty}>{scope === "overplan" ? "Brak inwestycji z przekroczonym planem robocizny." : "Brak ewidencji pracy lub planów dla inwestycji w wybranym miesiącu."}</div> : null}
    </div> : null}

    {scope === "all" && control.unassignedApprovedHours > 0 ? <button type="button" className={styles.unassignedNotice} onClick={() => setScope("unassigned")}><AlertTriangle size={15} /><span><strong>{number(control.unassignedApprovedHours)} h</strong> czasu nie ma wskazanej inwestycji.</span><span>Sprawdź →</span></button> : null}

    <p className={styles.sourceNote}>Automatyczny przepływ: wybór inwestycji w dziennej ewidencji → godziny → koszt/h pracownika → koszt rzeczywisty kontraktu. Zmiana inwestycji lub godzin natychmiast przelicza koszt. Formalne przypisania służą jedynie do planowania przyszłego obłożenia i porównania planu z wykonaniem.</p>
  </section>;
}
