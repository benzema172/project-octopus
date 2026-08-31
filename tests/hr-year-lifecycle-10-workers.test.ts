import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildHrEmployeeIssues } from "../lib/hr/employee-issues";
import { countPolishWorkingDays, isPolishWorkingDay } from "../lib/hr/polish-work-calendar";
import type { HrRow, HrWorkspaceData } from "../lib/hr/types";

const YEAR = 2026;
const YEAR_START = `${YEAR}-01-01`;
const YEAR_END = `${YEAR}-12-31`;

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
];

type LeavePlan = { employeeId: string; leaveType: string; from: string; to: string };
const leavePlans: LeavePlan[] = [
  { employeeId: "e01", leaveType: "annual", from: "2026-02-16", to: "2026-02-20" },
  { employeeId: "e01", leaveType: "annual", from: "2026-07-13", to: "2026-07-17" },
  { employeeId: "e02", leaveType: "annual", from: "2026-03-09", to: "2026-03-13" },
  { employeeId: "e02", leaveType: "annual", from: "2026-08-03", to: "2026-08-14" },
  { employeeId: "e03", leaveType: "annual", from: "2026-04-07", to: "2026-04-17" },
  { employeeId: "e03", leaveType: "annual", from: "2026-11-09", to: "2026-11-20" },
  { employeeId: "e04", leaveType: "annual", from: "2026-06-01", to: "2026-06-05" },
  { employeeId: "e04", leaveType: "sick", from: "2026-09-14", to: "2026-09-18" },
  { employeeId: "e05", leaveType: "annual", from: "2026-05-11", to: "2026-05-15" },
  { employeeId: "e05", leaveType: "on_demand", from: "2026-12-07", to: "2026-12-07" },
  { employeeId: "e06", leaveType: "annual", from: "2026-01-19", to: "2026-01-23" },
  { employeeId: "e06", leaveType: "annual", from: "2026-10-05", to: "2026-10-16" },
  { employeeId: "e07", leaveType: "annual", from: "2026-02-02", to: "2026-02-13" },
  { employeeId: "e07", leaveType: "annual", from: "2026-07-27", to: "2026-08-07" },
  { employeeId: "e08", leaveType: "annual", from: "2026-03-23", to: "2026-03-27" },
  { employeeId: "e08", leaveType: "sick", from: "2026-11-02", to: "2026-11-04" },
  { employeeId: "e09", leaveType: "annual", from: "2026-06-15", to: "2026-06-26" },
  { employeeId: "e09", leaveType: "annual", from: "2026-12-14", to: "2026-12-18" },
  { employeeId: "e10", leaveType: "annual", from: "2026-01-26", to: "2026-02-06" },
  { employeeId: "e10", leaveType: "annual", from: "2026-04-20", to: "2026-05-08" },
  { employeeId: "e10", leaveType: "annual", from: "2026-08-24", to: "2026-08-28" }
];

function isoDays(from: string, to: string) {
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
function activeProjectIds(date: string) { return projects.filter((project) => inRange(date, project.from, project.to)).map((project) => project.id); }
function weekNumber(date: string) { return Math.floor((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${YEAR_START}T00:00:00Z`).getTime()) / (7 * 86_400_000)); }

function leaveRows() {
  return leavePlans.map((leave, index) => ({
    id: `l${String(index + 1).padStart(2, "0")}`,
    employee_id: leave.employeeId,
    leave_type: leave.leaveType,
    date_from: leave.from,
    date_to: leave.to,
    days: countPolishWorkingDays(leave.from, leave.to),
    status: "approved",
    created_at: `${leave.from}T06:00:00Z`
  }));
}

function isAbsent(employeeId: string, date: string, leaves: HrRow[]) {
  return leaves.some((leave) => String(leave.employee_id) === employeeId && String(leave.status) === "approved" && String(leave.date_from) <= date && date <= String(leave.date_to));
}

function buildHistory() {
  const employees: HrRow[] = workers.map(([id, firstName, lastName], index) => ({
    id, employee_number: `R-${String(index + 1).padStart(3, "0")}`, first_name: firstName, last_name: lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}@octopus.test`,
    phone: `5000000${String(index + 1).padStart(2, "0")}`, status: "active", hired_at: YEAR_START
  }));
  const employments: HrRow[] = workers.map(([id, , , position], index) => ({
    id: `employment-${id}`, employee_id: id, employment_type: "employment_contract", position,
    valid_from: YEAR_START, valid_to: null, monthly_cost: 8200 + index * 350, hourly_cost: 49 + index * 1.75,
    settlement_model: "monthly", nominal_monthly_hours: 168
  }));
  const leaves = leaveRows();
  const timesheets: HrRow[] = [];
  const allWorkingDays = isoDays(YEAR_START, YEAR_END).filter(isPolishWorkingDay);
  for (const [employeeIndex, worker] of workers.entries()) {
    const employeeId = worker[0];
    let workedIndex = 0;
    for (const workDate of allWorkingDays) {
      if (isAbsent(employeeId, workDate, leaves)) continue;
      const availableProjects = activeProjectIds(workDate);
      if (!availableProjects.length) throw new Error(`Brak inwestycji dla ${workDate}.`);
      const projectId = availableProjects[(employeeIndex + weekNumber(workDate)) % availableProjects.length];
      const overtime = workedIndex > 0 && (workedIndex + employeeIndex) % 23 === 0 ? 2 : 0;
      const rate = Number(employments[employeeIndex].hourly_cost);
      timesheets.push({
        id: `t-${employeeId}-${workDate}`, employee_id: employeeId, project_id: projectId, work_date: workDate,
        hours: 8, overtime_hours: overtime, status: "approved", source: "year_lifecycle_test",
        hourly_cost_snapshot: rate, labor_cost_snapshot: (8 + overtime) * rate, cost_snapshot_at: `${workDate}T18:00:00Z`
      });
      workedIndex += 1;
    }
  }

  const assignments: HrRow[] = [];
  for (const [employeeIndex, worker] of workers.entries()) {
    for (let month = 1; month <= 12; month += 1) {
      const monthStart = `${YEAR}-${String(month).padStart(2, "0")}-01`;
      const monthEnd = new Date(Date.UTC(YEAR, month, 0)).toISOString().slice(0, 10);
      const candidates = activeProjectIds(monthStart).length ? activeProjectIds(monthStart) : activeProjectIds(monthEnd);
      const projectId = candidates[(employeeIndex + month) % candidates.length];
      assignments.push({ id: `a-${worker[0]}-${month}`, employee_id: worker[0], project_id: projectId, role: worker[3], date_from: monthStart, date_to: monthEnd, allocation_percent: 100 });
    }
  }

  const documents: HrRow[] = workers.map(([id, firstName, lastName]) => ({ id: `doc-${id}`, name: `Umowa o pracę - ${firstName} ${lastName}.pdf`, category: "hr", updated_at: `${YEAR_START}T08:00:00Z` }));
  const employeeDocuments: HrRow[] = workers.map(([id]) => ({ id: `edoc-${id}`, employee_id: id, document_id: `doc-${id}`, document_type: "Umowa o pracę / zatrudnienie", status: "active", source: "manual", ai_confidence: 1 }));

  const exams: HrRow[] = workers.map(([id]) => ({ id: `exam-${id}-base`, employee_id: id, exam_type: "Okresowe", examined_at: "2025-12-15", valid_until: "2027-12-31", status: "valid" }));
  exams.push(
    { id: "exam-e05-unfit", employee_id: "e05", exam_type: "Kontrolne", examined_at: "2026-08-01", valid_until: "2026-08-15", status: "unfit" },
    { id: "exam-e05-fit", employee_id: "e05", exam_type: "Kontrolne", examined_at: "2026-08-16", valid_until: "2027-08-16", status: "valid" }
  );

  const trainings: HrRow[] = workers.map(([id]) => ({ id: `bhp-${id}-base`, employee_id: id, training_type: "Okresowe BHP", completed_at: "2025-10-01", valid_until: id === "e07" ? "2026-10-15" : "2027-12-31", status: "valid" }));
  trainings.push({ id: "bhp-e07-renew", employee_id: "e07", training_type: "Okresowe BHP", completed_at: "2026-10-10", valid_until: "2027-10-10", status: "valid" });

  const qualifications: HrRow[] = workers.map(([id], index) => ({ id: `q-${id}-base`, employee_id: id, qualification_type: index % 3 === 0 ? "SEP" : index % 3 === 1 ? "UDT" : "F-Gazy", number: `UPR/${YEAR}/${index + 1}`, issued_at: "2025-01-10", valid_until: id === "e03" ? "2026-06-30" : "2028-12-31", status: "valid" }));
  qualifications.push({ id: "q-e03-renew", employee_id: "e03", qualification_type: "SEP", number: "SEP/RENEW/2026", issued_at: "2026-06-20", valid_until: "2031-06-20", status: "valid" });

  return { employees, employments, leaves, timesheets, assignments, documents, employeeDocuments, exams, trainings, qualifications, allWorkingDays };
}

const history = buildHistory();

function recordsAvailableAt(rows: HrRow[], referenceDate: string, keys: string[]) {
  return rows.filter((row) => {
    for (const key of keys) {
      if (row[key] && String(row[key]).slice(0, 10) > referenceDate) return false;
    }
    return true;
  });
}

function dataAt(referenceDate: string): HrWorkspaceData {
  const leaves = history.leaves.filter((row) => String(row.created_at).slice(0, 10) <= referenceDate);
  const timesheets = history.timesheets.filter((row) => String(row.work_date) <= referenceDate);
  const exams = recordsAvailableAt(history.exams, referenceDate, ["examined_at"]);
  const trainings = recordsAvailableAt(history.trainings, referenceDate, ["completed_at"]);
  const qualifications = recordsAvailableAt(history.qualifications, referenceDate, ["issued_at"]);
  const assignments = history.assignments.filter((row) => String(row.date_from) <= referenceDate);
  const annualLeaveRows = leaves.filter((row) => ["annual", "on_demand"].includes(String(row.leave_type)) && String(row.date_from) <= referenceDate);
  const leaveBalances = workers.map(([employeeId]) => {
    const used = annualLeaveRows.filter((row) => String(row.employee_id) === employeeId).reduce((sum, row) => {
      const to = String(row.date_to) > referenceDate ? referenceDate : String(row.date_to);
      return sum + (String(row.date_from) <= to ? countPolishWorkingDays(String(row.date_from), to) : 0);
    }, 0);
    return { employee_id: employeeId, entitlement_configured: true, annual_days: 26, carried_over_days: 0, extra_days: 0, used_days: used, remaining_days: 26 - used, overused_days: Math.max(0, used - 26) };
  });

  return {
    referenceDate, year: YEAR, employees: history.employees, projects: projects.map((project) => ({ id: project.id, name: project.name, status: "active" })),
    employments: history.employments, payrollMonths: [], qualifications, exams, trainings, leaves, timesheets, assignments,
    teams: [], teamMembers: [], documents: history.documents, employeeDocuments: history.employeeDocuments, unlinkedDocuments: [],
    entitlements: workers.map(([employeeId]) => ({ employee_id: employeeId, year: YEAR, annual_days: 26, carried_over_days: 0, extra_days: 0 })),
    leaveBalances, issuedAssets: [], complianceItems: [], projectStaff: [], auditEvents: [], alerts: [], summary: {}
  };
}

describe("Kadry Core 3.0 — pełny rok 10 robotników", () => {
  it("pokrywa każdy polski dzień roboczy pracą albo zatwierdzoną nieobecnością", () => {
    expect(history.employees).toHaveLength(10);
    expect(history.allWorkingDays.length).toBeGreaterThan(240);
    for (const [employeeId] of workers) {
      for (const date of history.allWorkingDays) {
        const work = history.timesheets.filter((row) => String(row.employee_id) === employeeId && String(row.work_date) === date);
        const absent = isAbsent(employeeId, date, history.leaves);
        expect(work.length + Number(absent)).toBe(1);
      }
    }
  });

  it("każdy wpis czasu ma inwestycję, snapshot kosztu i bezpieczny wymiar godzin", () => {
    const projectIds = new Set(projects.map((project) => project.id));
    const uniqueEmployeeDay = new Set<string>();
    for (const row of history.timesheets) {
      expect(projectIds.has(String(row.project_id))).toBe(true);
      expect(Number(row.hours)).toBe(8);
      expect(Number(row.overtime_hours)).toBeGreaterThanOrEqual(0);
      expect(Number(row.hours) + Number(row.overtime_hours)).toBeLessThanOrEqual(12);
      expect(Number(row.hourly_cost_snapshot)).toBeGreaterThan(0);
      expect(Number(row.labor_cost_snapshot)).toBeCloseTo((Number(row.hours) + Number(row.overtime_hours)) * Number(row.hourly_cost_snapshot), 6);
      const key = `${row.employee_id}|${row.work_date}`;
      expect(uniqueEmployeeDay.has(key)).toBe(false);
      uniqueEmployeeDay.add(key);
    }
  });

  it("symuluje realne urlopy, chorobowe i kontroluje limit roczny", () => {
    const finalData = dataAt(YEAR_END);
    const byEmployee = new Map(finalData.leaveBalances.map((row) => [String(row.employee_id), row]));
    for (const [employeeId] of workers.slice(0, 9)) expect(Number(byEmployee.get(employeeId)?.remaining_days)).toBeGreaterThanOrEqual(0);
    expect(Number(byEmployee.get("e10")?.remaining_days)).toBeLessThan(0);
    const issues = buildHrEmployeeIssues(finalData, { canViewPayroll: true });
    expect(issues.issues.some((row) => row.employeeId === "e10" && row.kind === "leave" && row.title.includes("Przekroczony limit"))).toBe(true);
  });

  it("wykrywa terminy BHP, uprawnienia i czasową niezdolność do pracy, a po odnowieniu czyści alert", () => {
    const june = buildHrEmployeeIssues(dataAt("2026-06-01"));
    expect(june.issues.some((row) => row.employeeId === "e03" && row.kind === "qualification" && row.title.includes("wygasa"))).toBe(true);

    const august = buildHrEmployeeIssues(dataAt("2026-08-10"));
    expect(august.issues.some((row) => row.employeeId === "e05" && row.kind === "medical" && row.severity === "critical" && row.title.includes("niezdolny"))).toBe(true);

    const september = buildHrEmployeeIssues(dataAt("2026-09-30"));
    expect(september.issues.some((row) => row.employeeId === "e07" && row.kind === "safety" && row.title.includes("wygasa"))).toBe(true);

    const finalIssues = buildHrEmployeeIssues(dataAt(YEAR_END));
    expect(finalIssues.issues.some((row) => ["medical", "safety", "qualification"].includes(row.kind) && row.severity === "critical")).toBe(false);
  });

  it("nie tworzy zaległych kart czasu ani braków umów/zatrudnienia po zamknięciu roku", () => {
    const issues = buildHrEmployeeIssues(dataAt(YEAR_END), { canViewPayroll: true });
    expect(issues.issues.some((row) => row.kind === "timesheet")).toBe(false);
    expect(issues.issues.some((row) => row.kind === "employment")).toBe(false);
    expect(issues.issues.some((row) => row.kind === "contract")).toBe(false);
    expect(issues.issues.some((row) => row.kind === "cost")).toBe(false);
  });

  it("przetwarza 12 miesięcznych kontroli roku w lekkim budżecie CPU", () => {
    const checkpoints = Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(YEAR, index + 1, 0)).toISOString().slice(0, 10));
    const started = performance.now();
    const summaries = checkpoints.map((date) => buildHrEmployeeIssues(dataAt(date), { canViewPayroll: true }));
    const elapsed = performance.now() - started;
    expect(summaries).toHaveLength(12);
    expect(summaries.every((summary) => summary.affectedEmployees <= 10)).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
