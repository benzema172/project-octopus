"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { HrTimesheetEntryEditor159 } from "./hr-timesheet-entry-editor-159";
import styles from "./hr-workspace-140.module.css";

type Row = Record<string, unknown>;
type Period = "day" | "month";

function str(value: unknown, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function num(value: unknown, digits = 1) { const n = Number(value ?? 0); return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(n) ? n : 0); }
function employeeName(row?: Row) { return row ? `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number) : "Pracownik"; }
function monthDates(referenceDate: string) { const year = Number(referenceDate.slice(0, 4)); const month = Number(referenceDate.slice(5, 7)); const days = new Date(Date.UTC(year, month, 0)).getUTCDate(); return Array.from({ length: days }, (_, index) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`); }
function entryHours(row: Row) { return Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0); }
function periodLabel(period: Period, referenceDate: string) {
  const parsed = new Date(`${period === "month" ? `${referenceDate.slice(0, 7)}-01` : referenceDate}T00:00:00Z`);
  return period === "month"
    ? parsed.toLocaleDateString("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" })
    : parsed.toLocaleDateString("pl-PL", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}
function exportHref(workspaceId: string, referenceDate: string, period: Period, employeeId?: string | null) { const params = new URLSearchParams({ workspaceId, mode: "timesheet", period, referenceDate }); if (employeeId) params.set("employeeId", employeeId); return `/api/company/hr/export?${params.toString()}`; }

export function HrTimeRecords159({ workspaceId, referenceDate, employees, projects, timesheets, canWrite, initialEmployeeId = null, onClearEmployeeFocus }: { workspaceId: string; referenceDate: string; employees: Row[]; projects: Row[]; timesheets: Row[]; canWrite: boolean; initialEmployeeId?: string | null; onClearEmployeeFocus?: () => void }) {
  const initialEmployee = initialEmployeeId ? employees.find((row) => String(row.id) === initialEmployeeId) ?? null : null;
  const [period, setPeriod] = useState<Period>(() => initialEmployee ? "month" : "day");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(() => initialEmployee ? String(initialEmployee.id) : null);
  const dates = useMemo(() => period === "day" ? [referenceDate] : monthDates(referenceDate), [period, referenceDate]);
  const dateSet = useMemo(() => new Set(dates), [dates]);
  const activeEmployees = useMemo(() => employees.filter((row) => row.status === "active"), [employees]);
  const focusedEmployee = useMemo(() => selectedEmployeeId ? employees.find((row) => String(row.id) === selectedEmployeeId) ?? null : null, [employees, selectedEmployeeId]);
  const visibleEmployees = useMemo(() => focusedEmployee ? [focusedEmployee] : activeEmployees, [focusedEmployee, activeEmployees]);
  const periodEntries = useMemo(() => timesheets.filter((row) => dateSet.has(String(row.work_date).slice(0, 10))), [timesheets, dateSet]);
  const visiblePeriodEntries = useMemo(() => focusedEmployee ? periodEntries.filter((row) => String(row.employee_id) === String(focusedEmployee.id)) : periodEntries, [focusedEmployee, periodEntries]);
  const entriesByEmployee = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of visiblePeriodEntries) {
      const employeeId = String(row.employee_id);
      map.set(employeeId, [...(map.get(employeeId) ?? []), row]);
    }
    return map;
  }, [visiblePeriodEntries]);
  const entriesByEmployeeDate = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of visiblePeriodEntries) {
      const key = `${String(row.employee_id)}|${String(row.work_date).slice(0, 10)}`;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [visiblePeriodEntries]);
  const periodTotal = visiblePeriodEntries.reduce((sum, row) => sum + entryHours(row), 0);

  const focusedName = focusedEmployee ? employeeName(focusedEmployee) : "";
  const focusedId = focusedEmployee ? String(focusedEmployee.id) : null;
  const clearFocus = () => {
    setSelectedEmployeeId(null);
    setPeriod("day");
    onClearEmployeeFocus?.();
  };

  return <article className={styles.panel} data-hr-editable-time-records="1" data-hr-employee-calendar={focusedId ?? undefined}>
    <div className={styles.panelHeader}>
      <div>
        <p className={styles.kicker}>{focusedEmployee ? "Kalendarz pracy pracownika" : period === "day" ? "Wybrany dzień" : "Miesiąc"}</p>
        <h2>{focusedEmployee ? `Kalendarz pracy — ${focusedName}` : "Pracownicy i czas pracy"}</h2>
        <div className={styles.subtle}>{periodLabel(period, referenceDate)} · {focusedEmployee ? "w komórkach widzisz godziny i inwestycję; kliknij dzień, aby edytować" : period === "day" ? "prosty spis pracowników — wybierz inwestycję i wpisz godziny" : "miesięczny podgląd godzin i inwestycji; kliknij dzień, aby edytować"}</div>
      </div>
      <div className={styles.splitButtons}>
        {focusedEmployee ? <button type="button" className={styles.buttonSecondary} onClick={clearFocus}><ArrowLeft size={15} /> Wszyscy pracownicy</button> : null}
        <button type="button" className={period === "day" ? styles.button : styles.buttonSecondary} aria-pressed={period === "day"} onClick={() => setPeriod("day")}>Dzień</button>
        <button type="button" className={period === "month" ? styles.button : styles.buttonSecondary} aria-pressed={period === "month"} onClick={() => setPeriod("month")}>Miesiąc</button>
        <a className={styles.buttonSecondary} href={exportHref(workspaceId, referenceDate, period, focusedId)}><Download size={15} /> Pobierz ewidencję</a>
        <span className={styles.chip}>{num(periodTotal)} h</span>
      </div>
    </div>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Pracownik</th>{dates.map((date) => <th key={date}>{period === "day" ? "Inwestycja i godziny" : date.slice(8)}</th>)}<th>Razem</th></tr></thead>
        <tbody>{visibleEmployees.map((employee) => {
          const employeeId = String(employee.id);
          const employeeEntries = entriesByEmployee.get(employeeId) ?? [];
          const total = employeeEntries.reduce((sum, row) => sum + entryHours(row), 0);
          return <tr key={employeeId}>
            <td><strong>{employeeName(employee)}</strong></td>
            {dates.map((date) => {
              const dayEntries = entriesByEmployeeDate.get(`${employeeId}|${date}`) ?? [];
              return <td key={date} style={{ minWidth: period === "month" ? 76 : 430, padding: 4 }}>
                {period === "day"
                  ? <HrTimesheetEntryEditor159 workspaceId={workspaceId} employeeId={employeeId} employeeName={employeeName(employee)} workDate={date} projects={projects} entries={dayEntries} canWrite={canWrite} variant="inline" />
                  : <HrTimesheetEntryEditor159 workspaceId={workspaceId} employeeId={employeeId} employeeName={employeeName(employee)} workDate={date} projects={projects} entries={dayEntries} canWrite={canWrite} variant="cell" />}
              </td>;
            })}
            <td><strong>{num(total)} h</strong></td>
          </tr>;
        })}</tbody>
      </table>
      {!visibleEmployees.length ? <div className={styles.empty}>{focusedEmployee ? "Nie znaleziono pracownika." : "Brak aktywnych pracowników."}</div> : null}
    </div>
  </article>;
}