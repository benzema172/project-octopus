"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Download, X } from "lucide-react";
import styles from "./hr-workspace-140.module.css";
import modal from "./hr-time-records-155.module.css";

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

function dayName(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.toLocaleDateString("pl-PL", { weekday: "long", timeZone: "UTC" });
}

function periodLabel(period: Period, referenceDate: string, dates: string[]) {
  if (period === "month") {
    const parsed = new Date(`${referenceDate.slice(0, 7)}-01T00:00:00Z`);
    return parsed.toLocaleDateString("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `${dates[0]?.slice(5) ?? ""}–${dates.at(-1)?.slice(5) ?? ""}`;
}

function statusLabel(value: unknown) {
  const status = String(value ?? "");
  const labels: Record<string, string> = {
    draft: "Szkic",
    submitted: "Do zatwierdzenia",
    approved: "Zatwierdzony",
    rejected: "Odrzucony"
  };
  return labels[status] ?? str(value);
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
  const selectedBaseHours = selectedEntries.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
  const selectedOvertime = selectedEntries.reduce((sum, row) => sum + Number(row.overtime_hours ?? 0), 0);
  const selectedTotal = selectedBaseHours + selectedOvertime;
  const selectedWorkedDays = new Set(selectedEntries.filter((row) => entryHours(row) > 0).map((row) => String(row.work_date).slice(0, 10))).size;
  const selectedProjects = new Set(selectedEntries.map((row) => String(row.project_id ?? "general"))).size;

  useEffect(() => {
    if (!selectedTimeEmployeeId) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedTimeEmployeeId(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedTimeEmployeeId]);

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
              <td><button type="button" className={modal.employeeButton} onClick={() => setSelectedTimeEmployeeId(String(employee.id))}><strong>{employeeName(employee)}</strong></button></td>
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

    {selectedEmployee && typeof document !== "undefined" ? createPortal(
      <div className={modal.layer}>
        <button className={modal.backdrop} type="button" onClick={() => setSelectedTimeEmployeeId(null)} aria-label="Zamknij ewidencję czasu" />
        <section className={modal.modal} role="dialog" aria-modal="true" aria-labelledby="time-records-employee-title">
          <header className={modal.header}>
            <div className={modal.titleBlock}>
              <p className={modal.kicker}>Ewidencja czasu pracy</p>
              <h2 id="time-records-employee-title">{employeeName(selectedEmployee)}</h2>
              <div className={modal.subtitle}>{periodLabel(period, referenceDate, dates)} · {num(selectedTotal)} h łącznie</div>
            </div>
            <button type="button" className={modal.close} onClick={() => setSelectedTimeEmployeeId(null)} aria-label="Zamknij"><X size={18} /></button>
          </header>

          <div className={modal.toolbar}>
            <div className={modal.periodGroup} aria-label="Zakres ewidencji">
              <button type="button" className={period === "week" ? modal.periodButtonActive : modal.periodButton} aria-pressed={period === "week"} onClick={() => setPeriod("week")}>7 dni</button>
              <button type="button" className={period === "month" ? modal.periodButtonActive : modal.periodButton} aria-pressed={period === "month"} onClick={() => setPeriod("month")}>Miesiąc</button>
            </div>
            <a className={modal.download} href={exportHref(workspaceId, referenceDate, period, String(selectedEmployee.id))}><Download size={15} /> Pobierz CSV</a>
          </div>

          <div className={modal.body}>
            <div className={modal.sectionIntro}>
              <div><h3><CalendarDays size={16} /> Kalendarz pracy</h3><p>Każdy dzień pokazuje inwestycję, godziny podstawowe, nadgodziny i status wpisu.</p></div>
            </div>
            <div className={modal.tableWrap}>
              <table className={modal.calendarTable}>
                <thead><tr><th>Data</th><th>Inwestycja / zakres</th><th>Godziny</th><th>Nadgodziny</th><th>Razem</th><th>Status</th></tr></thead>
                <tbody>{dates.map((date) => {
                  const dayEntries = selectedEntries.filter((row) => String(row.work_date).slice(0, 10) === date);
                  const base = dayEntries.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
                  const overtime = dayEntries.reduce((sum, row) => sum + Number(row.overtime_hours ?? 0), 0);
                  const statuses = Array.from(new Set(dayEntries.map((row) => statusLabel(row.status))));
                  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
                  return <tr key={date} className={weekday === 0 || weekday === 6 ? modal.weekend : undefined}>
                    <td className={modal.dateCell}><strong>{dayLabel(date)}</strong><span>{dayName(date)}</span></td>
                    <td>{dayEntries.length ? <div className={modal.projects}>{dayEntries.map((row) => <div className={modal.projectLine} key={String(row.id)}><strong>{str(projectById.get(String(row.project_id))?.name, "Koszt ogólny")}</strong><span>{num(entryHours(row))} h</span></div>)}</div> : <span className={modal.emptyDay}>Brak wpisu</span>}</td>
                    <td className={modal.numeric}>{dayEntries.length ? `${num(base)} h` : "—"}</td>
                    <td className={modal.numeric}>{dayEntries.length ? `${num(overtime)} h` : "—"}</td>
                    <td className={`${modal.numeric} ${modal.totalCell}`}>{dayEntries.length ? `${num(base + overtime)} h` : "—"}</td>
                    <td>{statuses.length ? statuses.map((status) => <span className={modal.status} key={status}>{status}</span>) : "—"}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>

            <section className={modal.summary} aria-label="Podsumowanie ewidencji czasu pracy">
              <div className={modal.summaryCard}><span>Zakres</span><strong>{period === "week" ? "7 dni" : "Miesiąc"}</strong></div>
              <div className={modal.summaryCard}><span>Dni z wpisem</span><strong>{selectedWorkedDays}</strong></div>
              <div className={modal.summaryCard}><span>Inwestycje</span><strong>{selectedProjects}</strong></div>
              <div className={modal.summaryCard}><span>Godziny podstawowe</span><strong>{num(selectedBaseHours)} h</strong></div>
              <div className={modal.summaryCard}><span>Nadgodziny</span><strong>{num(selectedOvertime)} h</strong></div>
              <div className={`${modal.summaryCard} ${modal.summaryPrimary}`}><span>Łącznie</span><strong>{num(selectedTotal)} h</strong></div>
            </section>
          </div>
        </section>
      </div>,
      document.body
    ) : null}
  </>;
}
