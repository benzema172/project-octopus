import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, UsersRound } from "lucide-react";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import {
  normalizeTeamMonth570,
  shiftTeamMonth570,
  summarizeProjectTimesheets570,
  teamMonthBounds570,
  type ProjectTimesheetRow570
} from "@/lib/investments/project-team-worklog-570";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const STATUS_LABELS: Record<string, string> = {
  approved: "Zatwierdzone",
  submitted: "Do zatwierdzenia",
  pending: "Oczekuje",
  draft: "Robocze",
  rejected: "Odrzucone"
};

const WORK_TYPE_LABELS: Record<string, string> = {
  regular: "Praca",
  overtime: "Nadgodziny",
  travel: "Dojazd",
  service: "Serwis"
};

function formatHours(value: number) {
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value)} h`;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${value}T12:00:00Z`));
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" })
    .format(new Date(`${value}-01T12:00:00Z`));
}

function timeRange(startedAt: unknown, endedAt: unknown) {
  const start = String(startedAt ?? "").slice(0, 5);
  const end = String(endedAt ?? "").slice(0, 5);
  return start && end ? `${start}–${end}` : "—";
}

export async function ProjectTeamWorklog570({ projectId, selectedMonth }: { projectId: string; selectedMonth?: string }) {
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();

  const month = normalizeTeamMonth570(selectedMonth);
  const { start, endExclusive } = teamMonthBounds570(month);
  const supabase = createServiceSupabaseClient();

  const [timesheetResult, assignmentResult, employeeResult] = await Promise.all([
    supabase
      .from("timesheets")
      .select("id,employee_id,work_date,hours,overtime_hours,status,work_type,work_scope,started_at,ended_at,note")
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .gte("work_date", start)
      .lt("work_date", endExclusive)
      .order("work_date", { ascending: false })
      .limit(1000),
    supabase
      .from("assignments")
      .select("id,employee_id,role,date_from,date_to,allocation_percent,created_at")
      .eq("workspace_id", project.workspace_id)
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("employees")
      .select("id,first_name,last_name,status")
      .eq("workspace_id", project.workspace_id)
      .limit(1000)
  ]);

  if (timesheetResult.error) console.error("Project Octopus: project team timesheets unavailable", timesheetResult.error.message);
  if (assignmentResult.error) console.error("Project Octopus: project team assignments unavailable", assignmentResult.error.message);
  if (employeeResult.error) console.error("Project Octopus: project team employees unavailable", employeeResult.error.message);

  const employees = employeeResult.data ?? [];
  const employeeNames = new Map(employees.map((employee) => [
    String(employee.id),
    `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim() || "Pracownik"
  ]));
  const rows = (timesheetResult.data ?? []) as ProjectTimesheetRow570[];
  const summary = summarizeProjectTimesheets570(rows, employeeNames);
  const today = new Date().toISOString().slice(0, 10);
  const activeAssignments = (assignmentResult.data ?? []).filter((assignment) =>
    (!assignment.date_from || String(assignment.date_from) <= today) &&
    (!assignment.date_to || String(assignment.date_to) >= today)
  );

  const previousMonth = shiftTeamMonth570(month, -1);
  const nextMonth = shiftTeamMonth570(month, 1);

  return (
    <section className="section-band pw-team-worklog" aria-labelledby="project-team-worklog-heading">
      <div className="section-heading pw-team-worklog__heading">
        <div>
          <p className="eyebrow">Ewidencja pracy</p>
          <h2 id="project-team-worklog-heading">Kto i kiedy pracował na inwestycji</h2>
          <p>Rzeczywiste wpisy czasu z Kadr przypisane bezpośrednio do tej inwestycji.</p>
        </div>
        <span>{summary.entryCount} wpisów · {formatHours(summary.totalHours)}</span>
      </div>

      <div className="pw-team-worklog__period">
        <Link href={`/workspace/projects/${projectId}/team?month=${previousMonth}`} aria-label="Poprzedni miesiąc"><ChevronLeft size={16} /></Link>
        <form action={`/workspace/projects/${projectId}/team`} method="get">
          <label>
            <span>Okres</span>
            <input type="month" name="month" defaultValue={month} aria-label="Miesiąc ewidencji pracy" />
          </label>
          <button type="submit" className="secondary-button">Pokaż</button>
        </form>
        <strong>{formatMonth(month)}</strong>
        <Link href={`/workspace/projects/${projectId}/team?month=${nextMonth}`} aria-label="Następny miesiąc"><ChevronRight size={16} /></Link>
      </div>

      <div className="pw-team-worklog__summary" aria-label="Podsumowanie okresu">
        <article><UsersRound size={16} /><span><small>Pracownicy</small><strong>{summary.employeeCount}</strong></span></article>
        <article><CalendarDays size={16} /><span><small>Dni z wpisami</small><strong>{summary.workDays}</strong></span></article>
        <article><Clock3 size={16} /><span><small>Godziny zatwierdzone</small><strong>{formatHours(summary.approvedHours)}</strong></span></article>
        <article><Clock3 size={16} /><span><small>Wszystkie godziny</small><strong>{formatHours(summary.totalHours)}</strong></span></article>
      </div>

      {summary.employees.length ? (
        <div className="pw-team-worklog__employees" aria-label="Podsumowanie pracowników">
          {summary.employees.map((employee) => (
            <article key={employee.employeeId}>
              <div><strong>{employee.employeeName}</strong><small>{employee.days} {employee.days === 1 ? "dzień" : "dni"} pracy · {formatDate(employee.firstDate)}–{formatDate(employee.lastDate)}</small></div>
              <span><strong>{formatHours(employee.totalHours)}</strong>{employee.overtimeHours > 0 ? <small>w tym {formatHours(employee.overtimeHours)} nadgodzin</small> : null}</span>
            </article>
          ))}
        </div>
      ) : null}

      {rows.length ? (
        <div className="pw-team-worklog__table-wrap">
          <table className="pw-team-worklog__table">
            <thead><tr><th>Data</th><th>Pracownik</th><th>Godziny</th><th>Nadgodziny</th><th>Czas</th><th>Status</th><th>Zakres / notatka</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const regular = Number(row.hours ?? 0) || 0;
                const overtime = Number(row.overtime_hours ?? 0) || 0;
                const status = String(row.status ?? "");
                const scope = String(row.work_scope ?? row.note ?? "").trim();
                const workType = WORK_TYPE_LABELS[String(row.work_type ?? "")] ?? String(row.work_type ?? "").trim();
                const statusLabel = (STATUS_LABELS[status] ?? status) || "—";
                return (
                  <tr key={row.id}>
                    <td><strong>{formatDate(row.work_date)}</strong></td>
                    <td>{employeeNames.get(String(row.employee_id)) ?? "Pracownik"}</td>
                    <td>{formatHours(regular)}</td>
                    <td>{overtime > 0 ? formatHours(overtime) : "—"}</td>
                    <td>{timeRange(row.started_at, row.ended_at)}</td>
                    <td><span className="pw-team-worklog__status" data-status={status}>{statusLabel}</span></td>
                    <td>{scope || workType || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pw-team-worklog__empty">
          <Clock3 size={22} />
          <strong>Brak wpisów czasu dla {formatMonth(month)}</strong>
          <span>Gdy w Kadrach pracownik otrzyma godziny przypisane do tej inwestycji, pojawią się tutaj automatycznie — z datą, liczbą godzin i statusem.</span>
        </div>
      )}

      <details className="pw-team-worklog__assignments">
        <summary><UsersRound size={16} />Aktualnie przypisani do inwestycji <span>{activeAssignments.length}</span></summary>
        <div>
          {activeAssignments.length ? activeAssignments.map((assignment) => (
            <article key={String(assignment.id)}>
              <strong>{employeeNames.get(String(assignment.employee_id)) ?? "Pracownik"}</strong>
              <span>{assignment.role || "Pracownik"} · {assignment.allocation_percent ?? "—"}% · {assignment.date_from ?? "od teraz"}–{assignment.date_to ?? "bezterminowo"}</span>
            </article>
          )) : <p>Brak aktywnych przypisań. Historyczna ewidencja pracy pozostaje widoczna niezależnie od aktualnego składu zespołu.</p>}
        </div>
      </details>
    </section>
  );
}
