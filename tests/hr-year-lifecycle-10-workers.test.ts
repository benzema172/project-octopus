import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildHrEmployeeIssues } from "../lib/hr/employee-issues";
import { countPolishWorkingDays, isPolishWorkingDay } from "../lib/hr/polish-work-calendar";
import type { HrRow, HrWorkspaceData } from "../lib/hr/types";

const YEAR = 2026;
const START = "2026-01-01";
const END = "2026-12-31";

const workers = [
  ["e01", "Adam", "Kowalski", "Monter sanitarny"],
  ["e02", "Bartosz", "Nowak", "Monter sanitarny"],
  ["e03", "Cezary", "Wiśniewski", "Brygadzista"],
  ["e04", "Damian", "Wójcik", "Monter wentylacji"],
  ["e05", "Emil", "Kowalczyk", "Monter instalacji"],
  ["e06", "Filip", "Kamiński", "Spawacz"],
  ["e07", "Grzegorz", "Lewandowski", "Monter HVAC"],
  ["e08", "Hubert", "Zieliński", "Pomocnik montera"],
  ["e09", "Igor", "Szymański", "Monter gazu"],
  ["e10", "Jakub", "Woźniak", "Monter sanitarny"]
] as const;

const projects = [
  { id: "p01", name: "Poznań – instalacje sanitarne biurowca", from: "2026-01-01", to: "2026-03-31" },
  { id: "p02", name: "Bydgoszcz – centrum logistyczne", from: "2026-02-01", to: "2026-06-30" },
  { id: "p03", name: "Piła – hala produkcyjna HVAC", from: "2026-05-01", to: "2026-09-30" },
  { id: "p04", name: "Wągrowiec – modernizacja kotłowni", from: "2026-08-01", to: "2026-12-31" }
] as const;

const leavePlans = [
  ["e01", "annual", "2026-02-16", "2026-02-20"], ["e01", "annual", "2026-07-13", "2026-07-17"],
  ["e02", "annual", "2026-03-09", "2026-03-13"], ["e02", "annual", "2026-08-03", "2026-08-14"],
  ["e03", "annual", "2026-04-07", "2026-04-17"], ["e03", "annual", "2026-11-09", "2026-11-20"],
  ["e04", "annual", "2026-06-01", "2026-06-05"], ["e04", "sick", "2026-09-14", "2026-09-18"],
  ["e05", "annual", "2026-05-11", "2026-05-15"], ["e05", "on_demand", "2026-12-07", "2026-12-07"],
  ["e06", "annual", "2026-01-19", "2026-01-23"], ["e06", "annual", "2026-10-05", "2026-10-16"],
  ["e07", "annual", "2026-02-02", "2026-02-13"], ["e07", "annual", "2026-07-27", "2026-08-07"],
  ["e08", "annual", "2026-03-23", "2026-03-27"], ["e08", "sick", "2026-11-02", "2026-11-04"],
  ["e09", "annual", "2026-06-15", "2026-06-26"], ["e09", "annual", "2026-12-14", "2026-12-18"],
  ["e10", "annual", "2026-01-26", "2026-02-06"], ["e10", "annual", "2026-04-20", "2026-05-08"],
  ["e10", "annual", "2026-08-24", "2026-08-28"]
] as const;

function days(from: string, to: string) {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function inRange(date: string, from: string, to: string) { return from <= date && date <= to; }
function projectIdsFor(date: string) { return projects.filter((project) => inRange(date, project.from, project.to)).map((project) => project.id); }
function weekIndex(date: string) { return Math.floor((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${START}T00:00:00Z`).getTime()) / 604_800_000); }

const leaves: HrRow[] = leavePlans.map(([employeeId, leaveType, from, to], index) => ({
  id: `leave-${index + 1}`,
  employee_id: employeeId,
  leave_type: leaveType,
  date_from: from,
  date_to: to,
  days: countPolishWorkingDays(from, to),
  status: "approved",
  created_at: `${from}T06:00:00Z`
}));

function absent(employeeId: string, date: string, rows = leaves) {
  return rows.some((row) => String(row.employee_id) === employeeId && row.status === "approved" && String(row.date_from) <= date && date <= String(row.date_to));
}

const employees: HrRow[] = workers.map(([id, firstName, lastName], index) => ({
  id,
  employee_number: `R-${String(index + 1).padStart(3, "0")}`,
  first_name: firstName,
  last_name: lastName,
  status: "active",
  hired_at: START
}));

const employments: HrRow[] = workers.map(([id, , , position], index) => ({
  id: `employment-${id}`,
  employee_id: id,
  employment_type: "employment_contract",
  position,
  valid_from: START,
  valid_to: null,
  monthly_cost: 8_200 + index * 350,
  hourly_cost: 49 + index * 1.75,
  nominal_monthly_hours: 168,
  settlement_model: "monthly"
}));

const workingDays = days(START, END).filter(isPolishWorkingDay);
const timesheets: HrRow[] = [];
for (const [employeeIndex, [employeeId]] of workers.entries()) {
  let sequence = 0;
  for (const workDate of workingDays) {
    if (absent(employeeId, workDate)) continue;
    const availableProjects = projectIdsFor(workDate);
    if (!availableProjects.length) throw new Error(`Brak inwestycji dla ${workDate}.`);
    const projectId = availableProjects[(employeeIndex + weekIndex(workDate)) % availableProjects.length];
    const overtime = sequence > 0 && (sequence + employeeIndex) % 23 === 0 ? 2 : 0;
    const rate = Number(employments[employeeIndex].hourly_cost);
    timesheets.push({
      id: `time-${employeeId}-${workDate}`,
      employee_id: employeeId,
      project_id: projectId,
      work_date: workDate,
      hours: 8,
      overtime_hours: overtime,
      status: "approved",
      source: "year_lifecycle_test",
      hourly_cost_snapshot: rate,
      labor_cost_snapshot: (8 + overtime) * rate,
      cost_snapshot_at: `${workDate}T18:00:00Z`
    });
    sequence += 1;
  }
}

const assignments: HrRow[] = [];
for (const [employeeIndex, worker] of workers.entries()) {
  for (let month = 1; month <= 12; month += 1) {
    const from = `${YEAR}-${String(month).padStart(2, "0")}-01`;
    const to = new Date(Date.UTC(YEAR, month, 0)).toISOString().slice(0, 10);
    const candidates = projectIdsFor(from).length ? projectIdsFor(from) : projectIdsFor(to);
    assignments.push({
      id: `assignment-${worker[0]}-${month}`,
      employee_id: worker[0],
      project_id: candidates[(employeeIndex + month) % candidates.length],
      role: worker[3],
      date_from: from,
      date_to: to,
      allocation_percent: 100
    });
  }
}

const documents: HrRow[] = workers.map(([id, firstName, lastName]) => ({ id: `doc-${id}`, name: `Umowa o pracę - ${firstName} ${lastName}.pdf`, category: "hr" }));
const employeeDocuments: HrRow[] = workers.map(([id]) => ({ id: `employee-doc-${id}`, employee_id: id, document_id: `doc-${id}`, document_type: "Umowa o pracę / zatrudnienie", status: "active", source: "manual", ai_confidence: 1 }));

const exams: HrRow[] = workers.map(([id]) => ({ id: `exam-${id}-base`, employee_id: id, exam_type: "Okresowe", examined_at: "2025-12-15", valid_until: "2027-12-31", status: "valid" }));
exams.push(
  { id: "exam-e05-unfit", employee_id: "e05", exam_type: "Kontrolne", examined_at: "2026-08-01", valid_until: "2026-08-15", status: "unfit" },
  { id: "exam-e05-fit", employee_id: "e05", exam_type: "Kontrolne", examined_at: "2026-08-16", valid_until: "2027-08-16", status: "valid" }
);

const trainings: HrRow[] = workers.map(([id]) => ({ id: `bhp-${id}-base`, employee_id: id, training_type: "Okresowe BHP", completed_at: "2025-10-01", valid_until: id === "e07" ? "2026-10-15" : "2027-12-31", status: "valid" }));
trainings.push({ id: "bhp-e07-renew", employee_id: "e07", training_type: "Okresowe BHP", completed_at: "2026-10-10", valid_until: "2027-10-10", status: "valid" });

const qualifications: HrRow[] = workers.map(([id], index) => ({
  id: `qualification-${id}-base`,
  employee_id: id,
  qualification_type: index % 3 === 0 ? "SEP" : index % 3 === 1 ? "UDT" : "F-Gazy",
  number: `UPR/${YEAR}/${index + 1}`,
  issued_at: "2025-01-10",
  valid_until: id === "e03" ? "2026-06-30" : "2028-12-31",
  status: "valid"
}));
qualifications.push({ id: "qualification-e03-renew", employee_id: "e03", qualification_type: "F-Gazy", number: "FGAZ/RENEW/2026", issued_at: "2026-06-20", valid_until: "2031-06-20", status: "valid" });

function availableAt(rows: HrRow[], referenceDate: string, eventKey: string) {
  return rows.filter((row) => !row[eventKey] || String(row[eventKey]).slice(0, 10) <= referenceDate);
}

function dataAt(referenceDate: string): HrWorkspaceData {
  const visibleLeaves = leaves.filter((row) => String(row.created_at).slice(0, 10) <= referenceDate);
  const visibleTimesheets = timesheets.filter((row) => String(row.work_date) <= referenceDate);
  const annualLeaves = visibleLeaves.filter((row) => ["annual", "on_demand"].includes(String(row.leave_type)) && String(row.date_from) <= referenceDate);
  const leaveBalances = workers.map(([employeeId]) => {
    const used = annualLeaves.filter((row) => String(row.employee_id) === employeeId).reduce((sum, row) => {
      const to = String(row.date_to) > referenceDate ? referenceDate : String(row.date_to);
      return sum + (String(row.date_from) <= to ? countPolishWorkingDays(String(row.date_from), to) : 0);
    }, 0);
    return { employee_id: employeeId, entitlement_configured: true, annual_days: 26, carried_over_days: 0, extra_days: 0, used_days: used, remaining_days: 26 - used, overused_days: Math.max(0, used - 26) };
  });

  return {
    referenceDate,
    year: YEAR,
    employees,
    projects: projects.map((project) => ({ id: project.id, name: project.name, status: "active" })),
    employments,
    payrollMonths: [],
    qualifications: availableAt(qualifications, referenceDate, "issued_at"),
    exams: availableAt(exams, referenceDate, "examined_at"),
    trainings: availableAt(trainings, referenceDate, "completed_at"),
    leaves: visibleLeaves,
    timesheets: visibleTimesheets,
    assignments: assignments.filter((row) => String(row.date_from) <= referenceDate),
    teams: [],
    teamMembers: [],
    documents,
    employeeDocuments,
    unlinkedDocuments: [],
    entitlements: workers.map(([employeeId]) => ({ employee_id: employeeId, year: YEAR, annual_days: 26, carried_over_days: 0, extra_days: 0 })),
    leaveBalances,
    issuedAssets: [],
    complianceItems: [],
    projectStaff: [],
    auditEvents: [],
    alerts: [],
    summary: {}
  };
}

describe("Kadry Core 3.0 — pełny rok 10 robotników", () => {
  it("pokrywa każdy polski dzień roboczy dokładnie pracą albo zatwierdzoną nieobecnością", () => {
    expect(employees).toHaveLength(10);
    expect(workingDays.length).toBeGreaterThan(240);
    for (const [employeeId] of workers) {
      for (const date of workingDays) {
        const workCount = timesheets.filter((row) => row.employee_id === employeeId && row.work_date === date).length;
        expect(workCount + Number(absent(employeeId, date))).toBe(1);
      }
    }
  });

  it("przypisuje każdy dzień pracy do inwestycji i zamraża poprawny koszt", () => {
    const validProjects = new Set(projects.map((project) => project.id));
    const employeeDays = new Set<string>();
    for (const row of timesheets) {
      expect(validProjects.has(String(row.project_id) as (typeof projects)[number]["id"])).toBe(true);
      expect(Number(row.hours)).toBe(8);
      expect(Number(row.hours) + Number(row.overtime_hours)).toBeLessThanOrEqual(12);
      expect(Number(row.hourly_cost_snapshot)).toBeGreaterThan(0);
      expect(Number(row.labor_cost_snapshot)).toBeCloseTo((Number(row.hours) + Number(row.overtime_hours)) * Number(row.hourly_cost_snapshot), 6);
      const key = `${row.employee_id}|${row.work_date}`;
      expect(employeeDays.has(key)).toBe(false);
      employeeDays.add(key);
    }
  });

  it("obsługuje urlopy, chorobowe i wykrywa celowe przekroczenie limitu", () => {
    const finalData = dataAt(END);
    const balances = new Map(finalData.leaveBalances.map((row) => [String(row.employee_id), row]));
    for (const [employeeId] of workers.slice(0, 9)) expect(Number(balances.get(employeeId)?.remaining_days)).toBeGreaterThanOrEqual(0);
    expect(Number(balances.get("e10")?.remaining_days)).toBeLessThan(0);
    const issues = buildHrEmployeeIssues(finalData, { canViewPayroll: true });
    expect(issues.issues.some((row) => row.employeeId === "e10" && row.kind === "leave" && row.title.includes("Przekroczony limit"))).toBe(true);
  });

  it("wykrywa termin uprawnienia, czasową niezdolność i BHP, a odnowienia czyszczą alerty", () => {
    const june = buildHrEmployeeIssues(dataAt("2026-06-01"));
    expect(june.issues.some((row) => row.employeeId === "e03" && row.kind === "qualification" && row.title.includes("wygasa"))).toBe(true);

    const august = buildHrEmployeeIssues(dataAt("2026-08-10"));
    expect(august.issues.some((row) => row.employeeId === "e05" && row.kind === "medical" && row.severity === "critical" && row.title.includes("niezdolny"))).toBe(true);

    const september = buildHrEmployeeIssues(dataAt("2026-09-30"));
    expect(september.issues.some((row) => row.employeeId === "e07" && row.kind === "safety" && row.title.includes("wygasa"))).toBe(true);

    const finalIssues = buildHrEmployeeIssues(dataAt(END));
    expect(finalIssues.issues.some((row) => ["medical", "safety", "qualification"].includes(row.kind) && row.severity === "critical")).toBe(false);
  });

  it("zamyka rok bez zaległych kart czasu, braków zatrudnienia, umów i kosztów", () => {
    const issues = buildHrEmployeeIssues(dataAt(END), { canViewPayroll: true });
    expect(issues.issues.some((row) => row.kind === "timesheet")).toBe(false);
    expect(issues.issues.some((row) => row.kind === "employment")).toBe(false);
    expect(issues.issues.some((row) => row.kind === "contract")).toBe(false);
    expect(issues.issues.some((row) => row.kind === "cost")).toBe(false);
  });

  it("wykonuje 12 miesięcznych kontroli centrum problemów w lekkim budżecie CPU", () => {
    const checkpoints = Array.from({ length: 12 }, (_, month) => new Date(Date.UTC(YEAR, month + 1, 0)).toISOString().slice(0, 10));
    const started = performance.now();
    const results = checkpoints.map((date) => buildHrEmployeeIssues(dataAt(date), { canViewPayroll: true }));
    const elapsed = performance.now() - started;
    expect(results).toHaveLength(12);
    expect(results.every((result) => result.affectedEmployees <= 10)).toBe(true);
    expect(elapsed).toBeLessThan(1_000);
  });
});
