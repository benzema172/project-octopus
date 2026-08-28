"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download } from "lucide-react";
import { HrTimesheetEntryEditor159 } from "./hr-timesheet-entry-editor-159";
import styles from "./hr-workspace-140.module.css";

type Row = Record<string, unknown>;
type Period = "week" | "month";

function str(value: unknown, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function num(value: unknown, digits = 1) { const n = Number(value ?? 0); return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(n) ? n : 0); }
function employeeName(row?: Row) { return row ? `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number) : "Pracownik"; }
function addDays(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function monthDates(referenceDate: string) { const year = Number(referenceDate.slice(0, 4)); const month = Number(referenceDate.slice(5, 7)); const days = new Date(Date.UTC(year, month, 0)).getUTCDate(); return Array.from({ length: days }, (_, index) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`); }
function entryHours(row: Row) { return Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0); }
function periodLabel(period: Period, referenceDate: string, dates: string[]) { if (period === "month") { const parsed = new Date(`${referenceDate.slice(0, 7)}-01T00:00:00Z`); return parsed.toLocaleDateString("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" }); } return `${dates[0]?.slice(5) ?? ""}–${dates.at(-1)?.slice(5) ?? ""}`; }
function exportHref(workspaceId: string, referenceDate: string, period: Period) { const params = new URLSearchParams({ workspaceId, mode: "timesheet", period, referenceDate }); return `/api/company/hr/export?${params.toString()}`; }

export function HrTimeRecords159({ workspaceId, referenceDate, employees, projects, timesheets, canWrite, initialEmployeeId = null, onClearEmployeeFocus }: { workspaceId: string; referenceDate: string; employees: Row[]; projects: Row[]; timesheets: Row[]; canWrite: boolean; initialEmployeeId?: string | null; onClearEmployeeFocus?: () => void }) {
  const initialEmployee = initialEmployeeId ? employees.find((row) => String(row.id) === initialEmployeeId) ?? null : null;
  const [period, setPeriod] = useState<Period>(() => initialEmployee ? "month" : "week");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(() => initialEmployee ? String(initialEmployee.id) : null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const dates = useMemo(() => period === "week" ? Array.from({ length: 7 }, (_, index) => addDays(referenceDate, index - 6)) : monthDates(referenceDate), [period, referenceDate]);
  const dateSet = useMemo(() => new Set(dates), [dates]);
  const activeEmployees = useMemo(() => employees.filter((row) => row.status === "active"), [employees]);
  const focusedEmployee = useMemo(() => selectedEmployeeId ? employees.find((row) => String(row.id) === selectedEmployeeId) ?? null : null, [employees, selectedEmployeeId]);
  const visibleEmployees = useMemo(() => focusedEmployee ? [focusedEmployee] : activeEmployees, [focusedEmployee, activeEmployees]);
  const periodEntries = useMemo(() => timesheets.filter((row) => dateSet.has(String(row.work_date).slice(0, 10))), [timesheets, dateSet]);
  const visiblePeriodEntries = useMemo(() => focusedEmployee ? periodEntries.filter((row) => String(row.employee_id) === String(focusedEmployee.id)) : periodEntries, [focusedEmployee, periodEntries]);
  const periodTotal = visiblePeriodEntries.reduce((sum, row) => sum + entryHours(row), 0);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-hr-workspace-slot="employees-shell"]');
    if (!root) return;
    let legacyPanel: HTMLElement | null = null;
    let legacyDisplay = "";
    let currentMount: HTMLElement | null = null;

    const sync = () => {
      const panel = Array.from(root.querySelectorAll<HTMLElement>("article"))
        .find((item) => item.querySelector("h2")?.textContent?.trim() === "Ewidencja czasu pracy") ?? null;
      if (!panel || panel === legacyPanel) return;
      if (legacyPanel) legacyPanel.style.display = legacyDisplay;
      currentMount?.remove();
      legacyPanel = panel;
      legacyDisplay = panel.style.display;
      panel.style.display = "none";
      currentMount = document.createElement("div");
      currentMount.dataset.hrEditableTimeRecordsMount = "1";
      panel.parentElement?.insertBefore(currentMount, panel);
      setMount(currentMount);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (legacyPanel) legacyPanel.style.display = legacyDisplay;
      currentMount?.remove();
    };
  }, []);

  if (!mount) return null;

  const focusedName = focusedEmployee ? employeeName(focusedEmployee) : "";
  const clearFocus = () => {
    setSelectedEmployeeId(null);
    setPeriod("week");
    onClearEmployeeFocus?.();
  };

  return createPortal(<article className={styles.panel} data-hr-editable-time-records="1" data-hr-employee-calendar={focusedEmployee ? String(focusedEmployee.id) : undefined}>
    <div className={styles.panelHeader}>
      <div>
        <p className={styles.kicker}>{focusedEmployee ? "Kalendarz pracy pracownika" : period === "week" ? "Ostatnie 7 dni" : "Miesiąc"}</p>
        <h2>{focusedEmployee ? `Kalendarz pracy — ${focusedName}` : "Ewidencja czasu pracy"}</h2>
        <div className={styles.subtle}>{periodLabel(period, referenceDate, dates)} · {focusedEmployee ? "w komórkach widzisz godziny i inwestycję; kliknij dzień, aby edytować" : "kliknij dowolny dzień, aby edytować inwestycję i godziny"}</div>
      </div>
      <div className={styles.splitButtons}>
        {focusedEmployee ? <button type="button" className={styles.buttonSecondary} onClick={clearFocus}><ArrowLeft size={15} /> Wszyscy pracownicy</button> : null}
        <button type="button" className={period === "week" ? styles.button : styles.buttonSecondary} aria-pressed={period === "week"} onClick={() => setPeriod("week")}>7 dni</button>
        <button type="button" className={period === "month" ? styles.button : styles.buttonSecondary} aria-pressed={period === "month"} onClick={() => setPeriod("month")}>Miesiąc</button>
        <a className={styles.buttonSecondary} href={exportHref(workspaceId, referenceDate, period)}><Download size={15} /> Pobierz ewidencję</a>
        <span className={styles.chip}>{num(periodTotal)} h</span>
      </div>
    </div>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Pracownik</th>{dates.map((date) => <th key={date}>{period === "week" ? date.slice(5) : date.slice(8)}</th>)}<th>Razem</th></tr></thead>
        <tbody>{visibleEmployees.map((employee) => {
          const employeeId = String(employee.id);
          const employeeEntries = visiblePeriodEntries.filter((row) => String(row.employee_id) === employeeId);
          const total = employeeEntries.reduce((sum, row) => sum + entryHours(row), 0);
          return <tr key={employeeId}>
            <td><strong>{employeeName(employee)}</strong></td>
            {dates.map((date) => {
              const dayEntries = employeeEntries.filter((row) => String(row.work_date).slice(0, 10) === date);
              return <td key={date} style={{ minWidth: period === "month" ? 76 : 92, padding: 4 }}><HrTimesheetEntryEditor159 workspaceId={workspaceId} employeeId={employeeId} employeeName={employeeName(employee)} workDate={date} projects={projects} entries={dayEntries} canWrite={canWrite} variant="cell" /></td>;
            })}
            <td><strong>{num(total)} h</strong></td>
          </tr>;
        })}</tbody>
      </table>
      {!visibleEmployees.length ? <div className={styles.empty}>{focusedEmployee ? "Nie znaleziono pracownika." : "Brak aktywnych pracowników."}</div> : null}
    </div>
  </article>, mount);
}
