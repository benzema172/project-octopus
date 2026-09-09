"use client";

import { CalendarDays, CalendarRange, ChevronDown, ChevronRight, Printer, UsersRound, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { isPolishWorkingDay } from "@/lib/hr/polish-work-calendar";
import type { HrWorkspaceData } from "@/lib/hr/types";
import styles from "./hr-attendance-list-500.module.css";

type Row = Record<string, unknown>;

type Props = {
  workspaceId: string;
  data: HrWorkspaceData;
};

type AttendanceDay = {
  date: string;
  dayName: string;
  status: string;
  statusKind: "work" | "vacation" | "sick" | "absence" | "missing" | "free" | "outside" | "conflict";
  hours: number;
};

type DayStatusRow = {
  id: string;
  employee_id: string;
  work_date: string;
  status: string;
  source?: string;
};

type PeriodReport = {
  employeeId: string;
  from: string;
  to: string;
  label: string;
};

type PrintTarget =
  | { kind: "month"; employeeId: string }
  | { kind: "report"; employeeId: string; from: string; to: string; label: string };

const vacationTypes = new Set(["annual", "on_demand", "unpaid"]);
const leaveLabels: Record<string, string> = {
  annual: "Urlop wypoczynkowy",
  on_demand: "Urlop na żądanie",
  unpaid: "Urlop bezpłatny",
  sick: "Zwolnienie chorobowe",
  maternity: "Urlop macierzyński",
  parental: "Urlop rodzicielski",
  care: "Opieka",
  other: "Nieobecność"
};

function fullName(row: Row) {
  return `${String(row.first_name ?? "")} ${String(row.last_name ?? "")}`.trim() || String(row.employee_number ?? "Pracownik");
}

function iso(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function monthDates(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const result: string[] = [];
  for (const date = new Date(first); date < next; date.setUTCDate(date.getUTCDate() + 1)) result.push(iso(date));
  return result;
}

function datesBetween(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return [];
  const result: string[] = [];
  const current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let guard = 0; current <= end && guard < 36600; guard += 1) {
    result.push(iso(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

function employedOn(employee: Row, date: string) {
  const from = employee.hired_at ? String(employee.hired_at).slice(0, 10) : "0000-01-01";
  const to = employee.terminated_at ? String(employee.terminated_at).slice(0, 10) : "9999-12-31";
  return from <= date && date <= to;
}

function inRange(date: string, from: unknown, to: unknown) {
  return (from ? String(from).slice(0, 10) : "0000-01-01") <= date && date <= (to ? String(to).slice(0, 10) : "9999-12-31");
}

function hoursLabel(hours: number) {
  return hours > 0 ? new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(hours) : "—";
}

function periodLabel(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  const end = new Date(`${to}T00:00:00Z`).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  return `${start} – ${end}`;
}

function monthName(value: string) {
  return new Date(`${value}-01T00:00:00Z`).toLocaleDateString("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" });
}

function dayStatusKey(employeeId: string, date: string) {
  return `${employeeId}|${date}`;
}

function summarize(rows: AttendanceDay[]) {
  return {
    workDays: rows.filter((row) => row.statusKind === "work").length,
    totalHours: rows.reduce((sum, row) => sum + row.hours, 0),
    vacationDays: rows.filter((row) => row.statusKind === "vacation").length,
    sickDays: rows.filter((row) => row.statusKind === "sick").length,
    absenceDays: rows.filter((row) => row.statusKind === "absence").length,
    missingDays: rows.filter((row) => row.statusKind === "missing").length
  };
}

function mergeDayStatuses(current: DayStatusRow[], incoming: DayStatusRow[], from: string, to: string) {
  const map = new Map<string, DayStatusRow>();
  for (const row of current) {
    const date = String(row.work_date).slice(0, 10);
    if (date < from || date > to) map.set(dayStatusKey(String(row.employee_id), date), row);
  }
  for (const row of incoming) map.set(dayStatusKey(String(row.employee_id), String(row.work_date).slice(0, 10)), row);
  return [...map.values()];
}

export function HrAttendanceList500({ workspaceId, data }: Props) {
  const [month, setMonth] = useState(data.referenceDate.slice(0, 7));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [rangeEmployeeId, setRangeEmployeeId] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState(`${data.referenceDate.slice(0, 4)}-01-01`);
  const [rangeTo, setRangeTo] = useState(data.referenceDate);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [printTarget, setPrintTarget] = useState<PrintTarget | null>(null);
  const [dayStatuses, setDayStatuses] = useState<DayStatusRow[]>([]);
  const [dayStatusError, setDayStatusError] = useState<string | null>(null);
  const [dayStatusLoading, setDayStatusLoading] = useState(false);

  const dates = useMemo(() => monthDates(month), [month]);
  const monthStart = dates[0] ?? `${month}-01`;
  const monthEnd = dates[dates.length - 1] ?? `${month}-31`;
  const selectedYear = month.slice(0, 4);
  const employees = useMemo(() => [...data.employees].sort((left, right) => fullName(left).localeCompare(fullName(right), "pl")), [data.employees]);

  const timesheetIndex = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of data.timesheets) {
      if (String(row.status ?? "") === "rejected") continue;
      const key = `${String(row.employee_id)}|${String(row.work_date).slice(0, 10)}`;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [data.timesheets]);

  const leaveIndex = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of data.leaves) {
      if (String(row.status ?? "") !== "approved") continue;
      const key = String(row.employee_id);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [data.leaves]);

  const dayStatusIndex = useMemo(() => new Map(dayStatuses.map((row) => [dayStatusKey(String(row.employee_id), String(row.work_date).slice(0, 10)), row])), [dayStatuses]);

  const fetchDayStatuses = useCallback(async (from: string, to: string) => {
    const params = new URLSearchParams({ workspaceId, from, to });
    const response = await fetch(`/api/company/hr/day-status?${params.toString()}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as { rows?: DayStatusRow[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Nie udało się pobrać statusów Chorobowe.");
    return result.rows ?? [];
  }, [workspaceId]);

  const loadDayStatuses = useCallback(async (from: string, to: string) => {
    setDayStatusLoading(true);
    setDayStatusError(null);
    try {
      const rows = await fetchDayStatuses(from, to);
      setDayStatuses((current) => mergeDayStatuses(current, rows, from, to));
      return true;
    } catch (reason) {
      setDayStatusError(reason instanceof Error ? reason.message : "Nie udało się pobrać statusów Chorobowe.");
      return false;
    } finally {
      setDayStatusLoading(false);
    }
  }, [fetchDayStatuses]);

  useEffect(() => {
    void loadDayStatuses(monthStart, monthEnd);
  }, [loadDayStatuses, monthEnd, monthStart]);

  const attendanceForDates = (employee: Row, requestedDates: string[]): AttendanceDay[] => {
    const id = String(employee.id);
    return requestedDates.map((date) => {
      const dayName = new Date(`${date}T00:00:00Z`).toLocaleDateString("pl-PL", { weekday: "short", timeZone: "UTC" });
      if (!employedOn(employee, date)) return { date, dayName, status: "Poza zatrudnieniem", statusKind: "outside", hours: 0 };
      const entries = timesheetIndex.get(`${id}|${date}`) ?? [];
      const hours = entries.reduce((sum, row) => sum + Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0), 0);
      const workingDay = isPolishWorkingDay(date);
      const leave = workingDay ? (leaveIndex.get(id) ?? []).find((row) => inRange(date, row.date_from, row.date_to)) : undefined;
      const sick = dayStatusIndex.get(dayStatusKey(id, date))?.status === "sick";
      if (sick && leave) return { date, dayName, status: "Konflikt: chorobowe + urlop / nieobecność", statusKind: "conflict", hours };
      if (sick && hours > 0) return { date, dayName, status: "Konflikt: chorobowe + praca", statusKind: "conflict", hours };
      if (leave && hours > 0) return { date, dayName, status: "Konflikt: nieobecność + praca", statusKind: "conflict", hours };
      if (sick) return { date, dayName, status: "Chorobowe", statusKind: "sick", hours: 0 };
      if (leave) {
        const type = String(leave.leave_type ?? "other");
        return { date, dayName, status: leaveLabels[type] ?? "Nieobecność", statusKind: vacationTypes.has(type) ? "vacation" : "absence", hours: 0 };
      }
      if (hours > 0) return { date, dayName, status: "Praca", statusKind: "work", hours };
      if (!workingDay) return { date, dayName, status: "Dzień wolny", statusKind: "free", hours: 0 };
      return { date, dayName, status: "Brak wpisu", statusKind: "missing", hours: 0 };
    });
  };

  const monthLabel = monthName(month);

  useEffect(() => {
    if (!printTarget) return;
    const afterPrint = () => setPrintTarget(null);
    window.addEventListener("afterprint", afterPrint, { once: true });
    const timer = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [printTarget]);

  const toggleEmployee = (employeeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const openRange = (employeeId: string) => {
    if (rangeEmployeeId === employeeId) {
      setRangeEmployeeId(null);
      setRangeError(null);
      return;
    }
    setRangeEmployeeId(employeeId);
    setRangeFrom(`${selectedYear}-01-01`);
    setRangeTo(`${selectedYear}-12-31`);
    setRangeError(null);
  };

  const generateYearReport = async (employeeId: string) => {
    const from = `${selectedYear}-01-01`;
    const to = `${selectedYear}-12-31`;
    if (!(await loadDayStatuses(from, to))) return;
    setRangeEmployeeId(null);
    setRangeError(null);
    setReport({ employeeId, from, to, label: `Podsumowanie roczne ${selectedYear}` });
  };

  const generateRangeReport = async (employeeId: string) => {
    if (!rangeFrom || !rangeTo) {
      setRangeError("Wybierz datę początkową i końcową.");
      return;
    }
    if (rangeFrom > rangeTo) {
      setRangeError("Data początkowa nie może być późniejsza niż końcowa.");
      return;
    }
    if (!(await loadDayStatuses(rangeFrom, rangeTo))) {
      setRangeError("Nie udało się pobrać statusów Chorobowe dla wybranego okresu.");
      return;
    }
    setRangeError(null);
    setReport({ employeeId, from: rangeFrom, to: rangeTo, label: "Podsumowanie od daty do daty" });
  };

  const renderMonthlySheet = (employee: Row, printOnly = false) => {
    const rows = attendanceForDates(employee, dates);
    const { vacationDays, sickDays } = summarize(rows);
    return <article className={`${styles.sheet} ${printOnly ? styles.sheetPrintOnly : ""}`}>
      <div className={styles.sheetHeader}>
        <div><small>LISTA OBECNOŚCI</small><h3>{fullName(employee)}</h3><p>{monthLabel}</p></div>
        <div className={styles.sheetHeaderRight}>
          <div className={styles.sheetMeta}><span>Nr pracownika: <b>{String(employee.employee_number ?? "—")}</b></span><span>Okres: <b>{monthStart} – {monthEnd}</b></span></div>
          {!printOnly ? <button type="button" className={styles.printButton} onClick={() => setPrintTarget({ kind: "month", employeeId: String(employee.id) })}><Printer size={14} /> Drukuj / Zapisz PDF</button> : null}
        </div>
      </div>
      <div className={styles.summary}><span className={styles.vacationSummary}><b>{vacationDays}</b> dni urlopu</span><span className={styles.sickSummary}><b>{sickDays}</b> dni chorobowego</span></div>
      <table className={styles.table}>
        <thead><tr><th>Lp.</th><th>Data</th><th>Dzień</th><th>Status</th><th>Godziny</th><th>Podpis pracownika</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.date} className={styles[`row_${row.statusKind}`]}><td>{index + 1}</td><td>{row.date}</td><td>{row.dayName}</td><td><span className={styles.status}>{row.status}</span></td><td>{hoursLabel(row.hours)}</td><td><span className={styles.signature} /></td></tr>)}</tbody>
      </table>
      <div className={styles.approval}><span>Podpis pracownika: <i /></span><span>Podpis przełożonego: <i /></span></div>
    </article>;
  };

  const renderPeriodReport = (employee: Row, currentReport: PeriodReport, printOnly = false) => {
    const reportDates = datesBetween(currentReport.from, currentReport.to);
    const reportRows = attendanceForDates(employee, reportDates);
    const totals = summarize(reportRows);
    const monthly = new Map<string, AttendanceDay[]>();
    for (const row of reportRows) {
      const key = row.date.slice(0, 7);
      monthly.set(key, [...(monthly.get(key) ?? []), row]);
    }
    const monthRows = [...monthly.entries()].sort(([left], [right]) => left.localeCompare(right));

    return <section className={`${styles.reportCard} ${printOnly ? styles.reportPrintOnly : ""}`} aria-label={`${currentReport.label}: ${fullName(employee)}`}>
      <header className={styles.reportHeader}>
        <div><small>PODSUMOWANIE OBECNOŚCI</small><h3>{fullName(employee)}</h3><p>{currentReport.label} · {periodLabel(currentReport.from, currentReport.to)}</p></div>
        {!printOnly ? <div className={styles.reportHeaderActions}><button type="button" onClick={() => setPrintTarget({ kind: "report", ...currentReport })}><Printer size={14} /> Drukuj / Zapisz PDF</button><button type="button" className={styles.closeButton} onClick={() => setReport(null)} aria-label="Zamknij podsumowanie"><X size={15} /></button></div> : null}
      </header>
      <div className={styles.reportStats}>
        <span><small>Dni pracy</small><b>{totals.workDays}</b></span>
        <span><small>Godziny</small><b>{hoursLabel(totals.totalHours)}</b></span>
        <span className={styles.reportVacation}><small>Dni urlopu</small><b>{totals.vacationDays}</b></span>
        <span className={styles.reportSick}><small>Chorobowe</small><b>{totals.sickDays}</b></span>
        <span><small>Inne nieobecności</small><b>{totals.absenceDays}</b></span>
        <span><small>Brak wpisu</small><b>{totals.missingDays}</b></span>
      </div>
      <div className={styles.reportTableWrap}><table className={styles.reportTable}>
        <thead><tr><th>Miesiąc</th><th>Dni pracy</th><th>Godziny</th><th>Dni urlopu</th><th>Chorobowe</th><th>Inne nieobecności</th><th>Brak wpisu</th></tr></thead>
        <tbody>{monthRows.map(([key, rows]) => {
          const summary = summarize(rows);
          return <tr key={key}><td>{monthName(key)}</td><td>{summary.workDays}</td><td>{hoursLabel(summary.totalHours)}</td><td><b>{summary.vacationDays}</b></td><td><b className={styles.sickValue}>{summary.sickDays}</b></td><td>{summary.absenceDays}</td><td>{summary.missingDays}</td></tr>;
        })}</tbody>
      </table></div>
    </section>;
  };

  const printEmployee = printTarget ? employees.find((employee) => String(employee.id) === printTarget.employeeId) ?? null : null;

  return <section className={styles.panel} aria-label="Lista obecności pracowników">
    <header className={styles.header}>
      <div className={styles.title}><span><CalendarDays size={18} /></span><div><p>Dokument kadrowy</p><h2>Lista obecności</h2><small>Pracownicy są domyślnie zwinięci. Rozwiń osobę, aby zobaczyć miesięczną listę, albo wygeneruj podsumowanie roczne / za dowolny okres.</small></div></div>
      <div className={styles.controls}><label><span>Miesiąc listy</span><input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /></label></div>
    </header>

    <div className={styles.info}><UsersRound size={15} /><span>{employees.length} {employees.length === 1 ? "pracownik" : "pracowników"}</span><b>·</b><span>{monthLabel}</span><b>·</b><span>listy domyślnie zwinięte</span>{dayStatusLoading ? <><b>·</b><span>aktualizacja chorobowego…</span></> : null}{dayStatusError ? <><b>·</b><span className={styles.statusLoadError} role="alert">{dayStatusError}</span></> : null}</div>

    <div className={styles.employeeListWrap}>
      <table className={styles.employeeList}>
        <thead><tr><th>Pracownik</th><th>Miesiąc</th><th>Urlop</th><th>Chorobowe</th><th>Podsumowania</th></tr></thead>
        <tbody>{employees.map((employee) => {
          const employeeId = String(employee.id);
          const expanded = expandedIds.has(employeeId);
          const monthRows = attendanceForDates(employee, dates);
          const summary = summarize(monthRows);
          const activeInMonth = monthRows.some((row) => row.statusKind !== "outside");
          const showRange = rangeEmployeeId === employeeId;
          const currentReport = report?.employeeId === employeeId ? report : null;
          return <Fragment key={employeeId}>
            <tr className={`${styles.employeeRow} ${expanded ? styles.employeeRowOpen : ""}`}>
              <td><button type="button" className={styles.employeeToggle} onClick={() => toggleEmployee(employeeId)} aria-expanded={expanded}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span><strong>{fullName(employee)}</strong><small>Nr pracownika: {String(employee.employee_number ?? "—")}</small></span></button></td>
              <td><span className={styles.monthCell}>{monthLabel}</span>{!activeInMonth ? <small className={styles.outsideEmployment}>Poza zatrudnieniem</small> : null}</td>
              <td><span className={styles.vacationCount}>{summary.vacationDays} {summary.vacationDays === 1 ? "dzień" : "dni"}</span></td>
              <td><span className={styles.sickCount}>{summary.sickDays} {summary.sickDays === 1 ? "dzień" : "dni"}</span></td>
              <td><div className={styles.rowActions}><button type="button" onClick={() => void generateYearReport(employeeId)}><CalendarDays size={14} /> Rok {selectedYear}</button><button type="button" onClick={() => openRange(employeeId)} className={showRange ? styles.actionActive : ""}><CalendarRange size={14} /> Od daty do daty</button></div></td>
            </tr>
            {showRange ? <tr className={styles.detailRow}><td colSpan={5}><div className={styles.rangePanel}>
              <div><strong>Podsumowanie za własny okres</strong><small>Wybierz datę początkową i końcową dla {fullName(employee)}.</small></div>
              <label><span>Od</span><input type="date" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} /></label>
              <label><span>Do</span><input type="date" value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} /></label>
              <button type="button" onClick={() => void generateRangeReport(employeeId)} disabled={dayStatusLoading}>Generuj podsumowanie</button>
              {rangeError ? <p className={styles.rangeError}>{rangeError}</p> : null}
            </div></td></tr> : null}
            {expanded ? <tr className={styles.detailRow}><td colSpan={5}><div className={styles.monthlyDetail}>{renderMonthlySheet(employee)}</div></td></tr> : null}
            {currentReport ? <tr className={styles.detailRow}><td colSpan={5}>{renderPeriodReport(employee, currentReport)}</td></tr> : null}
          </Fragment>;
        })}</tbody>
      </table>
      {!employees.length ? <div className={styles.empty}>Brak pracowników w firmie.</div> : null}
    </div>

    {printTarget && printEmployee ? <div className={styles.printDocument}>
      {printTarget.kind === "month"
        ? renderMonthlySheet(printEmployee, true)
        : renderPeriodReport(printEmployee, { employeeId: printTarget.employeeId, from: printTarget.from, to: printTarget.to, label: printTarget.label }, true)}
    </div> : null}
  </section>;
}
