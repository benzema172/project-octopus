"use client";

import { CalendarDays, Printer, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { isPolishWorkingDay } from "@/lib/hr/polish-work-calendar";
import type { HrWorkspaceData } from "@/lib/hr/types";
import styles from "./hr-attendance-list-500.module.css";

type Row = Record<string, unknown>;

type Props = {
  data: HrWorkspaceData;
};

type AttendanceDay = {
  date: string;
  dayName: string;
  status: string;
  statusKind: "work" | "vacation" | "absence" | "missing" | "free" | "outside" | "conflict";
  hours: number;
};

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

export function HrAttendanceList500({ data }: Props) {
  const [month, setMonth] = useState(data.referenceDate.slice(0, 7));
  const [employeeId, setEmployeeId] = useState("");
  const dates = useMemo(() => monthDates(month), [month]);
  const monthStart = dates[0] ?? `${month}-01`;
  const monthEnd = dates[dates.length - 1] ?? `${month}-31`;

  const employees = useMemo(() => data.employees.filter((row) => {
    const hired = row.hired_at ? String(row.hired_at).slice(0, 10) : "0000-01-01";
    const terminated = row.terminated_at ? String(row.terminated_at).slice(0, 10) : "9999-12-31";
    return hired <= monthEnd && terminated >= monthStart;
  }), [data.employees, monthEnd, monthStart]);

  const visibleEmployees = useMemo(() => employeeId ? employees.filter((row) => String(row.id) === employeeId) : employees, [employeeId, employees]);

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

  const attendanceFor = (employee: Row): AttendanceDay[] => {
    const id = String(employee.id);
    return dates.map((date) => {
      const dayName = new Date(`${date}T00:00:00Z`).toLocaleDateString("pl-PL", { weekday: "short", timeZone: "UTC" });
      if (!employedOn(employee, date)) return { date, dayName, status: "Poza zatrudnieniem", statusKind: "outside", hours: 0 };
      const entries = timesheetIndex.get(`${id}|${date}`) ?? [];
      const hours = entries.reduce((sum, row) => sum + Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0), 0);
      const workingDay = isPolishWorkingDay(date);
      const leave = workingDay ? (leaveIndex.get(id) ?? []).find((row) => inRange(date, row.date_from, row.date_to)) : undefined;
      if (leave && hours > 0) return { date, dayName, status: "Konflikt: nieobecność + praca", statusKind: "conflict", hours };
      if (leave) {
        const type = String(leave.leave_type ?? "other");
        return { date, dayName, status: leaveLabels[type] ?? "Nieobecność", statusKind: vacationTypes.has(type) ? "vacation" : "absence", hours: 0 };
      }
      if (hours > 0) return { date, dayName, status: "Praca", statusKind: "work", hours };
      if (!workingDay) return { date, dayName, status: "Dzień wolny", statusKind: "free", hours: 0 };
      return { date, dayName, status: "Brak wpisu", statusKind: "missing", hours: 0 };
    });
  };

  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" });

  return <section className={styles.panel} aria-label="Lista obecności pracowników">
    <header className={styles.header}>
      <div className={styles.title}><span><CalendarDays size={18} /></span><div><p>Dokument kadrowy</p><h2>Lista obecności</h2><small>Miesięczna lista dla każdego pracownika — gotowa do wydruku, podpisu lub zapisania jako PDF.</small></div></div>
      <div className={styles.controls}>
        <label><span>Miesiąc</span><input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /></label>
        <label><span>Pracownik</span><select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Wszyscy pracownicy</option>{employees.map((employee) => <option key={String(employee.id)} value={String(employee.id)}>{fullName(employee)}</option>)}</select></label>
        <button type="button" onClick={() => window.print()}><Printer size={15} /> Drukuj / Zapisz PDF</button>
      </div>
    </header>

    <div className={styles.info}><UsersRound size={15} /><span>{visibleEmployees.length} {visibleEmployees.length === 1 ? "pracownik" : "pracowników"}</span><b>·</b><span>{monthLabel}</span><b>·</b><span>{dates.length} dni kalendarzowych</span></div>

    <div className={styles.printArea}>
      {visibleEmployees.map((employee) => {
        const rows = attendanceFor(employee);
        const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
        const workDays = rows.filter((row) => row.statusKind === "work").length;
        const vacationDays = rows.filter((row) => row.statusKind === "vacation").length;
        const absenceDays = rows.filter((row) => row.statusKind === "absence").length;
        const missingDays = rows.filter((row) => row.statusKind === "missing").length;
        return <article className={styles.sheet} key={String(employee.id)}>
          <div className={styles.sheetHeader}>
            <div><small>LISTA OBECNOŚCI</small><h3>{fullName(employee)}</h3><p>{monthLabel}</p></div>
            <div className={styles.sheetMeta}><span>Nr pracownika: <b>{String(employee.employee_number ?? "—")}</b></span><span>Okres: <b>{monthStart} – {monthEnd}</b></span></div>
          </div>
          <div className={styles.summary}>
            <span><b>{workDays}</b> dni pracy</span><span><b>{hoursLabel(totalHours)}</b> h</span><span><b>{vacationDays}</b> dni urlopu</span><span><b>{absenceDays}</b> inne nieobecności</span>{missingDays ? <span className={styles.missingSummary}><b>{missingDays}</b> brak wpisu</span> : null}
          </div>
          <table className={styles.table}>
            <thead><tr><th>Lp.</th><th>Data</th><th>Dzień</th><th>Status</th><th>Godziny</th><th>Podpis pracownika</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={row.date} className={styles[`row_${row.statusKind}`]}><td>{index + 1}</td><td>{row.date}</td><td>{row.dayName}</td><td><span className={styles.status}>{row.status}</span></td><td>{hoursLabel(row.hours)}</td><td><span className={styles.signature} /></td></tr>)}</tbody>
          </table>
          <div className={styles.approval}><span>Podpis pracownika: <i /></span><span>Podpis przełożonego: <i /></span></div>
        </article>;
      })}
      {!visibleEmployees.length ? <div className={styles.empty}>Brak pracowników zatrudnionych w wybranym miesiącu.</div> : null}
    </div>
  </section>;
}
