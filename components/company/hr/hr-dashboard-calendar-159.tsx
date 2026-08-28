"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { HrTimesheetEntryEditor159 } from "./hr-timesheet-entry-editor-159";
import styles from "./hr-dashboard-calendar-147.module.css";

type Row = Record<string, unknown>;
type CalendarData = {
  referenceDate: string;
  employees: Row[];
  projects: Row[];
  timesheets: Row[];
  assignments: Row[];
  leaves: Row[];
  teams: Row[];
};

type DayStatus = "work" | "absence" | "missing" | "outside" | "conflict";
type EmployeeDay = { employee: Row; name: string; status: DayStatus; statusLabel: string; location: string; hours: number; overtime: number };

const weekdays = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
const leaveLabels: Record<string, string> = { annual: "Urlop wypoczynkowy", on_demand: "Urlop na żądanie", sick: "Zwolnienie chorobowe", unpaid: "Urlop bezpłatny", maternity: "Urlop macierzyński", parental: "Urlop rodzicielski", care: "Opieka", other: "Nieobecność" };

function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function parseIso(value: string) { const [year, month, day] = value.split("-").map(Number); return new Date(year, Math.max(0, month - 1), day || 1); }
function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonths(date: Date, months: number) { return new Date(date.getFullYear(), date.getMonth() + months, 1); }
function calendarStart(date: Date) { const first = startOfMonth(date); const mondayOffset = (first.getDay() + 6) % 7; return new Date(first.getFullYear(), first.getMonth(), first.getDate() - mondayOffset); }
function fullName(row: Row) { return `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim() || String(row.employee_number ?? "Pracownik"); }
function inRange(date: string, from: unknown, to: unknown) { return (from ? String(from).slice(0, 10) : "0000-01-01") <= date && date <= (to ? String(to).slice(0, 10) : "9999-12-31"); }
function employedOn(employee: Row, date: string) { const hiredAt = employee.hired_at ? String(employee.hired_at).slice(0, 10) : "0000-01-01"; const terminatedAt = employee.terminated_at ? String(employee.terminated_at).slice(0, 10) : "9999-12-31"; if (date < hiredAt || date > terminatedAt) return false; if (!employee.hired_at && !employee.terminated_at && employee.status && employee.status !== "active") return false; return true; }
function formatHours(value: number) { return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value); }

export function HrDashboardCalendar159({ workspaceId, canWrite, data, onOpenEmployeeCalendar }: { workspaceId: string; canWrite: boolean; data: CalendarData; onOpenEmployeeCalendar?: (employeeId: string, referenceDate: string) => void }) {
  const reference = useMemo(() => parseIso(data.referenceDate), [data.referenceDate]);
  const [viewDate, setViewDate] = useState(() => startOfMonth(reference));
  const [selectedDate, setSelectedDate] = useState(data.referenceDate);
  const projectNames = useMemo(() => new Map(data.projects.map((row) => [String(row.id), String(row.name ?? "Inwestycja")])), [data.projects]);
  const teamProjects = useMemo(() => new Map(data.teams.map((row) => [String(row.id), row.project_id ? String(row.project_id) : ""])), [data.teams]);
  const timesheetIndex = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of data.timesheets) {
      const key = `${String(row.employee_id)}|${String(row.work_date).slice(0, 10)}`;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [data.timesheets]);
  const assignmentIndex = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of data.assignments) {
      const employeeId = String(row.employee_id);
      map.set(employeeId, [...(map.get(employeeId) ?? []), row]);
    }
    return map;
  }, [data.assignments]);
  const approvedLeaveIndex = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of data.leaves) {
      if (String(row.status) !== "approved") continue;
      const employeeId = String(row.employee_id);
      map.set(employeeId, [...(map.get(employeeId) ?? []), row]);
    }
    return map;
  }, [data.leaves]);

  const employeeEntries = (employeeId: string, date: string) => timesheetIndex.get(`${employeeId}|${date}`) ?? [];
  const assignmentIds = (employeeId: string, date: string) => (assignmentIndex.get(employeeId) ?? []).filter((row) => inRange(date, row.date_from, row.date_to)).map((row) => String(row.project_id ?? "")).filter(Boolean);

  const employeeDay = (employee: Row, date: string): EmployeeDay => {
    const employeeId = String(employee.id);
    if (!employedOn(employee, date)) return { employee, name: fullName(employee), status: "outside", statusLabel: "Poza zatrudnieniem", location: "—", hours: 0, overtime: 0 };
    const leaves = (approvedLeaveIndex.get(employeeId) ?? []).filter((row) => inRange(date, row.date_from, row.date_to));
    const sheets = employeeEntries(employeeId, date);
    const hours = sheets.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
    const overtime = sheets.reduce((sum, row) => sum + Number(row.overtime_hours ?? 0), 0);
    const sheetProjectIds = sheets.map((row) => row.project_id ? String(row.project_id) : row.team_id ? teamProjects.get(String(row.team_id)) ?? "" : "").filter(Boolean);
    const assignmentProjectIds = assignmentIds(employeeId, date);
    const projectIds = Array.from(new Set(sheetProjectIds.length ? sheetProjectIds : assignmentProjectIds));
    const location = projectIds.map((id) => projectNames.get(id) ?? "Inwestycja").join(" / ") || "Brak przypisania";
    if (leaves.length && (hours > 0 || overtime > 0)) return { employee, name: fullName(employee), status: "conflict", statusLabel: "Urlop + wpis czasu", location, hours, overtime };
    if (leaves.length) { const label = leaveLabels[String(leaves[0].leave_type ?? "other")] ?? "Nieobecność"; return { employee, name: fullName(employee), status: "absence", statusLabel: label, location: label, hours: 0, overtime: 0 }; }
    if (hours > 0 || overtime > 0) return { employee, name: fullName(employee), status: "work", statusLabel: "Praca", location, hours, overtime };
    return { employee, name: fullName(employee), status: "missing", statusLabel: assignmentProjectIds.length ? "Brak wpisu czasu" : "Brak danych", location: assignmentProjectIds.length ? location : "Brak przypisania", hours: 0, overtime: 0 };
  };

  const selectedRows = data.employees.map((employee) => employeeDay(employee, selectedDate));
  const selectedSummary = { work: selectedRows.filter((row) => row.status === "work").length, absence: selectedRows.filter((row) => row.status === "absence").length, missing: selectedRows.filter((row) => row.status === "missing").length, conflict: selectedRows.filter((row) => row.status === "conflict").length };
  const days = useMemo(() => { const first = calendarStart(viewDate); return Array.from({ length: 42 }, (_, index) => { const date = new Date(first); date.setDate(first.getDate() + index); return date; }); }, [viewDate]);
  const monthLabel = viewDate.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
  const selected = parseIso(selectedDate);
  const selectedLabel = selected.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return <section className={styles.calendarPanel} aria-label="Miesięczny kalendarz kadr" data-hr-editable-calendar="1">
    <header className={styles.header}>
      <div className={styles.titleBlock}><span className={styles.icon}><CalendarDays size={18} /></span><div><p className={styles.kicker}>Pulpit kadr</p><h2>Kalendarz miesięczny</h2><p>Kliknij dzień, a pod kalendarzem wybierzesz inwestycję i wpiszesz godziny pracownika.</p></div></div>
      <strong className={styles.monthTitle}>{monthLabel}</strong>
      <div className={styles.controls}><button type="button" className={styles.iconButton} onClick={() => setViewDate((current) => addMonths(current, -1))} aria-label="Poprzedni miesiąc"><ChevronLeft size={17} /></button><button type="button" className={styles.todayButton} onClick={() => { setViewDate(startOfMonth(reference)); setSelectedDate(data.referenceDate); }}>Dzisiaj</button><button type="button" className={styles.iconButton} onClick={() => setViewDate((current) => addMonths(current, 1))} aria-label="Następny miesiąc"><ChevronRight size={17} /></button></div>
    </header>

    <div className={styles.calendarScroll}><div className={styles.calendarGrid} role="grid" aria-label={monthLabel}>
      {weekdays.map((weekday, index) => <div className={`${styles.weekday} ${index > 4 ? styles.weekendLabel : ""}`} role="columnheader" key={weekday}>{weekday}</div>)}
      {days.map((day) => {
        const value = isoDate(day); const currentMonth = day.getMonth() === viewDate.getMonth(); const isToday = value === data.referenceDate; const isSelected = value === selectedDate; const isWeekend = day.getDay() === 0 || day.getDay() === 6;
        const rows = data.employees.map((employee) => employeeDay(employee, value));
        const work = rows.filter((row) => row.status === "work").length; const absence = rows.filter((row) => row.status === "absence").length; const missing = rows.filter((row) => row.status === "missing").length; const conflict = rows.filter((row) => row.status === "conflict").length; const signalTotal = work + absence + missing + conflict;
        return <button type="button" role="gridcell" aria-selected={isSelected} aria-label={day.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} className={`${styles.day} ${!currentMonth ? styles.outside : ""} ${isWeekend ? styles.weekend : ""} ${isToday ? styles.today : ""} ${isSelected ? styles.selected : ""}`} key={value} onClick={() => setSelectedDate(value)}>
          <div className={styles.dayTop}><span className={styles.dayNumber}>{day.getDate()}</span>{isToday ? <span className={styles.todayChip}>Dziś</span> : null}</div>
          <div className={styles.dayCounters} aria-hidden="true">{work ? <span className={styles.counterWork}>{work}</span> : null}{absence ? <span className={styles.counterAbsence}>{absence}</span> : null}{missing ? <span className={styles.counterMissing}>{missing}</span> : null}{conflict ? <span className={styles.counterConflict}>{conflict}</span> : null}</div>
          <span className={styles.stateBar} aria-hidden="true">{work ? <i className={styles.barWork} style={{ flexGrow: work / Math.max(1, signalTotal) }} /> : null}{absence ? <i className={styles.barAbsence} style={{ flexGrow: absence / Math.max(1, signalTotal) }} /> : null}{missing ? <i className={styles.barMissing} style={{ flexGrow: missing / Math.max(1, signalTotal) }} /> : null}{conflict ? <i className={styles.barConflict} style={{ flexGrow: conflict / Math.max(1, signalTotal) }} /> : null}</span>
        </button>;
      })}
    </div></div>

    <section className={styles.dayDrawer} key={selectedDate} aria-label={`Status pracowników: ${selectedLabel}`}>
      <header className={styles.drawerHeader}><div><small>Wybrany dzień</small><h3>{selectedLabel}</h3></div><div className={styles.drawerStatusRow}><div className={styles.summaryChips}><span className={styles.summaryWork}>{selectedSummary.work} praca</span><span className={styles.summaryAbsence}>{selectedSummary.absence} nieobecność</span><span className={styles.summaryMissing}>{selectedSummary.missing} brak wpisu</span>{selectedSummary.conflict ? <span className={styles.summaryConflict}>{selectedSummary.conflict} konflikt</span> : null}</div><div className={styles.legend} aria-label="Legenda statusów kalendarza"><span><i className={styles.legendWork} /> Praca</span><span><i className={styles.legendAbsence} /> Nieobecność</span><span><i className={styles.legendMissing} /> Brak wpisu</span><span><i className={styles.legendConflict} /> Konflikt danych</span></div></div></header>
      <div className={styles.employeeTable}>
        <div className={styles.tableHead}><span><UsersRound size={14} /> Pracownik</span><span><MapPin size={14} /> Inwestycja / edycja</span><span><Clock3 size={14} /> Godziny</span></div>
        {selectedRows.length ? selectedRows.map((row) => {
          const employeeId = String(row.employee.id); const entries = employeeEntries(employeeId, selectedDate); const suggestedProjectId = assignmentIds(employeeId, selectedDate)[0] ?? ""; const editable = row.status !== "outside";
          return <div className={styles.employeeRow} key={employeeId}>
            <div className={styles.employeeCell}>
              <i className={`${styles.statusDot} ${styles[`status_${row.status}`]}`} aria-hidden="true" />
              <button type="button" className={styles.employeeLink} onClick={() => onOpenEmployeeCalendar?.(employeeId, selectedDate)} title={`Otwórz kalendarz pracy: ${row.name}`}>{row.name}</button>
              <small className={`${styles.statusBadge} ${styles[`badge_${row.status}`]}`}>{row.statusLabel}</small>
            </div>
            {editable ? <div className={styles.inlineEditorCell}><HrTimesheetEntryEditor159 workspaceId={workspaceId} employeeId={employeeId} employeeName={row.name} workDate={selectedDate} projects={data.projects} entries={entries} canWrite={canWrite} variant="inline" suggestedProjectId={suggestedProjectId} /></div> : <><div className={styles.locationCell}><span>{row.location}</span></div><div className={styles.hoursCell}><strong>{formatHours(row.hours + row.overtime)} h</strong>{row.overtime > 0 ? <small>w tym {formatHours(row.overtime)} nadg.</small> : null}</div></>}
          </div>;
        }) : <div className={styles.empty}>Brak pracowników w ewidencji.</div>}
      </div>
    </section>
  </section>;
}
