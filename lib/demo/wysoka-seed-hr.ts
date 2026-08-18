import { asId, ensureRow, type Db, type SeedInput } from "@/lib/demo/wysoka-seed-shared";

export async function seedHr(db: Db, input: SeedInput) {
  let created = 0;
  const employees = [
    ["TEST-001", "Adam", "Nowak", "Kierownik robót sanitarnych", 14500, 92],
    ["TEST-002", "Marek", "Kowalski", "Brygadzista", 10800, 68],
    ["TEST-003", "Piotr", "Zieliński", "Monter instalacji", 8600, 54],
    ["TEST-004", "Tomasz", "Wiśniewski", "Monter instalacji", 8400, 53],
    ["TEST-005", "Kamil", "Lewandowski", "Monter wentylacji", 8800, 55],
    ["TEST-006", "Łukasz", "Kamiński", "Spawacz", 9600, 60],
    ["TEST-007", "Paweł", "Wójcik", "Pomocnik montera", 6900, 43],
    ["TEST-008", "Rafał", "Dąbrowski", "Magazynier", 7200, 45],
    ["TEST-009", "Michał", "Król", "Serwisant HVAC", 9300, 58],
    ["TEST-010", "Anna", "Kaczmarek", "Specjalista ds. dokumentacji", 8200, 51]
  ] as const;
  const ids = new Map<string, string>();
  for (const [employeeNumber, firstName, lastName, position, monthlyCost, hourlyCost] of employees) {
    const employee = await ensureRow(db, "employees", { workspace_id: input.workspaceId, employee_number: employeeNumber }, {
      first_name: firstName, last_name: lastName, email: `${firstName}.${lastName}.test@example.invalid`.toLowerCase(),
      phone: `+48 500 00${employeeNumber.slice(-2)} 00`, status: "active", hired_at: "2025-01-02"
    });
    if (employee.created) created += 1;
    const employeeId = asId(employee.row);
    ids.set(employeeNumber, employeeId);
    const employment = await ensureRow(db, "employments", { workspace_id: input.workspaceId, employee_id: employeeId, valid_from: "2026-01-01" }, {
      employment_type: "umowa_o_prace", position, full_time_equivalent: 1, monthly_cost: monthlyCost, hourly_cost: hourlyCost, currency: "PLN"
    });
    if (employment.created) created += 1;
    const assignment = await ensureRow(db, "assignments", { workspace_id: input.workspaceId, employee_id: employeeId, project_id: input.projectId }, {
      role: position, date_from: "2026-06-15", date_to: "2026-11-30", allocation_percent: employeeNumber === "TEST-008" ? 40 : 80
    });
    if (assignment.created) created += 1;
  }

  for (const employeeNumber of ["TEST-001", "TEST-002", "TEST-006", "TEST-009"]) {
    const employeeId = ids.get(employeeNumber)!;
    const q = await ensureRow(db, "qualifications", { workspace_id: input.workspaceId, employee_id: employeeId, qualification_type: "SEP / uprawnienia testowe" }, {
      number: `SEP-${employeeNumber}`, issued_at: "2025-03-01", valid_until: "2030-03-01", status: "valid"
    });
    if (q.created) created += 1;
    const exam = await ensureRow(db, "medical_exams", { workspace_id: input.workspaceId, employee_id: employeeId, exam_type: "Badanie okresowe" }, {
      examined_at: "2026-02-02", valid_until: "2027-02-02", status: "valid"
    });
    if (exam.created) created += 1;
  }

  for (const employeeNumber of ["TEST-001", "TEST-002", "TEST-003", "TEST-005", "TEST-010"]) {
    const employeeId = ids.get(employeeNumber)!;
    const balance = await ensureRow(db, "leave_balances", { workspace_id: input.workspaceId, employee_id: employeeId, year: 2026 }, {
      entitlement_days: 26, used_days: employeeNumber === "TEST-003" ? 8 : 4, carried_days: employeeNumber === "TEST-010" ? 2 : 0
    });
    if (balance.created) created += 1;
  }
  for (const [employeeNumber, leaveType, dateFrom, dateTo, days, status] of [
    ["TEST-003", "urlop_wypoczynkowy", "2026-08-24", "2026-08-28", 5, "approved"],
    ["TEST-005", "urlop_wypoczynkowy", "2026-09-07", "2026-09-08", 2, "pending"],
    ["TEST-010", "opieka", "2026-08-21", "2026-08-21", 1, "approved"]
  ] as const) {
    const employeeId = ids.get(employeeNumber)!;
    const leave = await ensureRow(db, "leave_requests", { workspace_id: input.workspaceId, employee_id: employeeId, date_from: dateFrom, date_to: dateTo }, {
      leave_type: leaveType, days, status, approved_by: status === "approved" ? input.actorId : null
    });
    if (leave.created) created += 1;
  }

  const timeSpecs = [
    ["TEST-001", "2026-08-17", 8, 0], ["TEST-002", "2026-08-17", 8, 1], ["TEST-003", "2026-08-17", 8, 0],
    ["TEST-004", "2026-08-17", 8, 0], ["TEST-005", "2026-08-17", 7.5, 0.5], ["TEST-006", "2026-08-17", 8, 2],
    ["TEST-001", "2026-08-18", 8, 0], ["TEST-002", "2026-08-18", 8, 0], ["TEST-003", "2026-08-18", 8, 0]
  ] as const;
  for (const [employeeNumber, workDate, hours, overtimeHours] of timeSpecs) {
    const employeeId = ids.get(employeeNumber)!;
    const row = await ensureRow(db, "timesheets", { workspace_id: input.workspaceId, employee_id: employeeId, project_id: input.projectId, work_date: workDate }, {
      hours, overtime_hours: overtimeHours, status: "approved", approved_by: input.actorId
    });
    if (row.created) created += 1;
  }
  const resourceSpecs = [
    ["TEST-001", "Kierownik robót sanitarnych", "2026-08-17", 40, 100],
    ["TEST-002", "Brygadzista", "2026-08-17", 40, 100],
    ["TEST-003", "Monter instalacji", "2026-08-17", 40, 100],
    ["TEST-005", "Monter wentylacji", "2026-08-17", 40, 100],
    ["TEST-006", "Spawacz", "2026-08-17", 32, 80],
    ["TEST-001", "Kierownik robót sanitarnych", "2026-08-24", 40, 100],
    ["TEST-002", "Brygadzista", "2026-08-24", 40, 100],
    ["TEST-005", "Monter wentylacji", "2026-08-24", 40, 100]
  ] as const;
  for (const [employeeNumber, role, weekStart, plannedHours, allocationPercent] of resourceSpecs) {
    const employeeId = ids.get(employeeNumber)!;
    const row = await ensureRow(db, "resource_plan_entries", { workspace_id: input.workspaceId, project_id: input.projectId, employee_id: employeeId, week_start: weekStart }, {
      role, planned_hours: plannedHours, allocation_percent: allocationPercent, status: "planned", note: "Plan zasobów testowy Wysoka", created_by: input.actorId
    });
    if (row.created) created += 1;
  }
  return { created, employeeIds: ids };
}
