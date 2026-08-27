"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Download, X } from "lucide-react";
import styles from "./hr-workspace-140.module.css";

type Row = Record<string, unknown>;
type Period = "week" | "month";

function str(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function num(value: unknown, digits = 1) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(n) ? n : 0);
}

function employeeName(row?: Row) {
  return row ? `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number) : "Pracownik";
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthDates(referenceDate: string) {
  const year = Number(referenceDate.slice(0, 4));
  const month = Number(referenceDate.slice(5, 7));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`);
}

function entryHours(row: Row) {
  return Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0);
}

function dayLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.toLocaleDateString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

function periodLabel(period: Period, referenceDate: string, dates: string[]) {
  if (period === "month") {
    const parsed = new Date(`${referenceDate.slice(0, 7)}-01T00:00:00Z`);
    return parsed.toLocaleDateString("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `${dates[0]?.slice(5) ?? ""}–${dates.at(-1)?.slice(5) ?? ""}`;
}

function exportHref(workspaceId: string, referenceDate: string, period: Period, employeeId?: string | null) {
  const params = new URLSearchParams({
    workspaceId,
    mode: "timesheet",
    period,
    referenceDate
  });
  if (employeeId) params.set("employeeId", employeeId);
  return `/api/company/hr/export?${params.toString()}`;
}

export function HrTimeRecords145({ workspaceId, referenceDate, employees, projects, timesheets }: {
  workspaceId: string;
  referenceDate: string;
  employees: Row[];
  projects: Row[];
  timesheets: Row[];
}) {
  const [period, setPeriod] = useState<Period>("week");
  const [selectedTimeEmployeeId, setSelectedTimeEmployeeId] = useState<string | null>(null);
  const projectById = useMemo(() => new Map(projects.map((row) => [String(row.id), row])), [projects]);
  const activeEmployees = useMemo(() => employees.filter((row) => row.status === "active"), [employees]);
  const dates = useMemo(() => period === "week" ? Array.from({ length: 7 }, (_, index) => addDays(referenceDate, index - 6)) : monthDates(referenceDate), [period, referenceDate]);
  const dateSet = useMemo(() => new Set(dates), [dates]);
  const periodEntries = useMemo(() => timesheets.filter((row) => dateSet.has(String(row.work_date).slice(0, 10))), [timesheets, dateSet]);
  const periodTotal = periodEntries.reduce((sum, row) => sum + entryHours(row), 0);
  const selectedEmployee = selectedTimeEmployeeId ? activeEmployees.find((row) => String(row.id) === selectedTimeEmployeeId) ?? employees.find((row) => String(row.id) === selectedTimeEmployeeId) ?? null : null;
  const selectedEntries = selectedTimeEmployeeId ? periodEntries.filter((row) => String(row.employee_id) === selectedTimeEmployeeId) : [];
  const selectedTotal = selectedEntries.reduce((sum, row) => sum + entryHours(row), 0);

  return <>
    <article className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>{period === "week" ? "Ostatnie 7 dni" : "Miesiąc"}</p>
          <h2>Ewidencja czasu pracy</h2>
          <div className={styles.subtle}>{periodLabel(period, referenceDate, dates)}</div>
        </div>
        <div className={styles.splitButtons}>
          <button type="button" className={period === "week" ? styles.button : styles.buttonSecondary} aria-pressed={period === "week"} onClick={() => setPeriod("week")}>7 dni</button>
          <button type="button" className={period === "month" ? styles.button : styles.buttonSecondary} aria-pressed={period === "month"} onClick={() => setPeriod("month")}>Miesiąc</button>
          <a className={styles.buttonSecondary} href={exportHref(workspaceId, referenceDate, period)}><Download size={15} /> Pobierz ewidencję</a>
          <span className={styles.chip}>{num(periodTotal)} h</span>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Pracownik</th>{dates.map((date) => <th key={date}>{period === "week" ? date.slice(5) : date.slice(8)}</th>)}<th>Razem</th></tr></thead>
          <tbody>{activeEmployees.map((employee) => {
            const employeeEntries = periodEntries.filter((row) => String(row.employee_id) === String(employee.id));
            const total = employeeEntries.reduce((sum, row) => sum + entryHours(row), 0);
            return <tr key={String(employee.id)}>
              <td><button type="button" onClick={() => setSelectedTimeEmployeeId(String(employee.id))} style={{ border: 0, padding: 0, background: "transparent", font: "inherit", cursor: "pointer", textAlign: "left" }}><strong>{employeeName(employee)}</strong></button></td>
              {dates.map((date) => {
                const dayEntries = employeeEntries.filter((row) => String(row.work_date).slice(0, 10) === date);
                const day = dayEntries.reduce((sum, row) => sum + entryHours(row), 0);
                return <td key={date} title={dayEntries.map((row) => `${str(projectById.get(String(row.project_id))?.name, "Koszt ogólny")}: ${num(entryHours(row))} h`).join("\n")}>{day ? `${num(day)} h` : "—"}</td>;
              })}
              <td><strong>{num(total)} h</strong></td>
            </tr>;
          })}</tbody>
        </table>
        {!activeEmployees.length ? <div className={styles.empty}>Brak aktywnych pracowników.</div> : null}
      </div>
    </article>

    {selectedEmployee ? <div className={styles.profileLayer}>
      <button className={styles.backdrop} type="button" onClick={() => setSelectedTimeEmployeeId(null)} aria-label="Zamknij ewidencję czasu" />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Ewidencja czasu pracy ${employeeName(selectedEmployee)}`}>
        <header className={styles.drawerHeader}>
          <div>
            <p className={styles.kicker}>Ewidencja czasu pracy</p>
            <h2>{employeeName(selectedEmployee)}</h2>
            <div className={styles.subtle}>{periodLabel(period, referenceDate, dates)} · {num(selectedTotal)} h</div>
          </div>
          <button type="button" className={styles.iconButton} onClick={() => setSelectedTimeEmployeeId(null)} aria-label="Zamknij"><X size={18} /></button>
        </header>
        <div className={styles.profileSections}>
          <section className={styles.profileSection}>
            <div className={styles.panelHeader}>
              <div><h3>Kalendarz pracy</h3><p className={styles.subtle}>Budowa/inwestycja i liczba godzin w każdym dniu.</p></div>
              <div className={styles.splitButtons}>
                <button type="button" className={period === "week" ? styles.button : styles.buttonSecondary} aria-pressed={period === "week"} onClick={() => setPeriod("week")}>7 dni</button>
                <button type="button" className={period === "month" ? styles.button : styles.buttonSecondary} aria-pressed={period === "month"} onClick={() => setPeriod("month")}>Miesiąc</button>
                <a className={styles.buttonSecondary} href={exportHref(workspaceId, referenceDate, period, String(selectedEmployee.id))}><Download size={15} /> Pobierz</a>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: period === "week" ? "repeat(7, minmax(150px, 1fr))" : "repeat(7, minmax(135px, 1fr))", gap: 8, minWidth: period === "week" ? 1050 : 945 }}>
                {dates.map((date) => {
                  const dayEntries = selectedEntries.filter((row) => String(row.work_date).slice(0, 10) === date);
                  const total = dayEntries.reduce((sum, row) => sum + entryHours(row), 0);
                  return <article key={date} style={{ border: "1px solid var(--line, #e5e7eb)", borderRadius: 12, padding: 10, minHeight: 112, background: "var(--surface, #fff)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}><strong>{dayLabel(date)}</strong><span className={styles.chip}>{total ? `${num(total)} h` : "—"}</span></div>
                    {dayEntries.length ? dayEntries.map((row) => <div key={String(row.id)} style={{ padding: "6px 0", borderTop: "1px solid var(--line, #eef0f3)" }}>
                      <strong style={{ display: "block" }}>{str(projectById.get(String(row.project_id))?.name, "Koszt ogólny")}</strong>
                      <span className={styles.subtle}>{num(entryHours(row))} h{Number(row.overtime_hours ?? 0) ? ` · nadgodziny ${num(row.overtime_hours)} h` : ""} · {str(row.status)}</span>
                    </div>) : <div className={styles.subtle}>Brak wpisu</div>}
                  </article>;
                })}
              </div>
            </div>
          </section>
          <section className={styles.profileSection}>
            <div className={styles.miniGrid}>
              <div className={styles.mini}><small>Zakres</small><strong>{period === "week" ? "7 dni" : "Miesiąc"}</strong></div>
              <div className={styles.mini}><small>Łącznie</small><strong>{num(selectedTotal)} h</strong></div>
              <div className={styles.mini}><small>Dni z wpisem</small><strong>{new Set(selectedEntries.map((row) => String(row.work_date).slice(0, 10))).size}</strong></div>
              <div className={styles.mini}><small>Inwestycje</small><strong>{new Set(selectedEntries.map((row) => String(row.project_id ?? "general"))).size}</strong></div>
            </div>
          </section>
        </div>
      </aside>
    </div> : null}
  </>;
}
