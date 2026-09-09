export type ProjectTimesheetRow570 = {
  id: string;
  employee_id: string;
  work_date: string;
  hours: number | string | null;
  overtime_hours: number | string | null;
  status: string | null;
  work_type?: string | null;
  work_scope?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  note?: string | null;
};

export type ProjectEmployeeWorkSummary570 = {
  employeeId: string;
  employeeName: string;
  hours: number;
  overtimeHours: number;
  totalHours: number;
  days: number;
  firstDate: string;
  lastDate: string;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function currentTeamMonth570(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function normalizeTeamMonth570(value: unknown, now = new Date()) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return MONTH_RE.test(candidate) ? candidate : currentTeamMonth570(now);
}

export function shiftTeamMonth570(month: string, delta: number) {
  const normalized = MONTH_RE.test(month) ? month : currentTeamMonth570();
  const [year, monthNumber] = normalized.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return currentTeamMonth570(shifted);
}

export function teamMonthBounds570(month: string) {
  const normalized = MONTH_RE.test(month) ? month : currentTeamMonth570();
  return {
    start: `${normalized}-01`,
    endExclusive: `${shiftTeamMonth570(normalized, 1)}-01`
  };
}

export function summarizeProjectTimesheets570(
  rows: ProjectTimesheetRow570[],
  employeeNames: Map<string, string>
) {
  const byEmployee = new Map<string, {
    employeeId: string;
    employeeName: string;
    hours: number;
    overtimeHours: number;
    dates: Set<string>;
  }>();

  let totalHours = 0;
  let approvedHours = 0;
  const workDates = new Set<string>();

  for (const row of rows) {
    const hours = numeric(row.hours);
    const overtimeHours = numeric(row.overtime_hours);
    const rowTotal = hours + overtimeHours;
    totalHours += rowTotal;
    if (String(row.status) === "approved") approvedHours += rowTotal;
    if (row.work_date) workDates.add(row.work_date);

    const employeeId = String(row.employee_id);
    const current = byEmployee.get(employeeId) ?? {
      employeeId,
      employeeName: employeeNames.get(employeeId) ?? "Pracownik",
      hours: 0,
      overtimeHours: 0,
      dates: new Set<string>()
    };
    current.hours += hours;
    current.overtimeHours += overtimeHours;
    if (row.work_date) current.dates.add(row.work_date);
    byEmployee.set(employeeId, current);
  }

  const employees: ProjectEmployeeWorkSummary570[] = [...byEmployee.values()].map((entry) => {
    const dates = [...entry.dates].sort();
    return {
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      hours: entry.hours,
      overtimeHours: entry.overtimeHours,
      totalHours: entry.hours + entry.overtimeHours,
      days: dates.length,
      firstDate: dates[0] ?? "",
      lastDate: dates.at(-1) ?? ""
    };
  }).sort((a, b) => b.totalHours - a.totalHours || a.employeeName.localeCompare(b.employeeName, "pl"));

  return {
    employees,
    totalHours,
    approvedHours,
    workDays: workDates.size,
    employeeCount: employees.length,
    entryCount: rows.length
  };
}
