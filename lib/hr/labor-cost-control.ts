export type HrLaborRow = Record<string, unknown>;

export type LaborEmployeeCost = {
  employeeId: string;
  allocationPercent: number;
  plannedHours: number;
  plannedCost: number;
  approvedHours: number;
  overtimeHours: number;
  actualCost: number;
  pendingHours: number;
  pendingCost: number;
  hourlyCost: number;
  hasAssignment: boolean;
  complianceRisk: "expired" | "expiring" | null;
};

export type LaborProjectCost = {
  projectId: string;
  employeeCosts: LaborEmployeeCost[];
  people: number;
  plannedHours: number;
  plannedCost: number;
  approvedHours: number;
  overtimeHours: number;
  actualCost: number;
  pendingHours: number;
  pendingCost: number;
  overPlan: boolean;
  warnings: string[];
};

export type LaborControlResult = {
  month: string;
  projects: LaborProjectCost[];
  actualCost: number;
  approvedHours: number;
  overtimeHours: number;
  pendingCost: number;
  unassignedApprovedHours: number;
  unassignedActualCost: number;
  unassignedPendingHours: number;
  unassignedPendingCost: number;
  overPlanProjects: number;
};

function dateOnly(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function activeOn(row: HrLaborRow, date: string, fromKey = "valid_from", toKey = "valid_to") {
  const start = dateOnly(row[fromKey]) || "0000-01-01";
  const end = dateOnly(row[toKey]) || "9999-12-31";
  return start <= date && date <= end;
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(days).padStart(2, "0")}`,
    days
  };
}

function overlapDays(row: HrLaborRow, month: string) {
  const { start, end } = monthBounds(month);
  const rowStart = dateOnly(row.date_from) || start;
  const rowEnd = dateOnly(row.date_to) || end;
  const overlapStart = rowStart > start ? rowStart : start;
  const overlapEnd = rowEnd < end ? rowEnd : end;
  if (overlapStart > overlapEnd) return 0;
  const from = new Date(`${overlapStart}T00:00:00Z`).getTime();
  const to = new Date(`${overlapEnd}T00:00:00Z`).getTime();
  return Math.floor((to - from) / 86_400_000) + 1;
}

export function employmentForDate(employments: HrLaborRow[], employeeId: string, date: string) {
  return employments.find((row) => String(row.employee_id) === employeeId && activeOn(row, date));
}

export function hourlyEmployerCost(employment?: HrLaborRow) {
  if (!employment) return 0;
  const explicit = Number(employment.hourly_cost ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const monthly = Number(employment.monthly_cost ?? 0);
  const nominal = Number(employment.nominal_monthly_hours ?? 0);
  if (!Number.isFinite(monthly) || !Number.isFinite(nominal) || monthly <= 0 || nominal <= 0) return 0;
  return monthly / nominal;
}

function complianceRisk(complianceItems: HrLaborRow[], employeeId: string, referenceDate: string): "expired" | "expiring" | null {
  const limit = new Date(`${referenceDate}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 30);
  const limit30 = limit.toISOString().slice(0, 10);
  let expiring = false;
  for (const row of complianceItems) {
    if (String(row.employee_id) !== employeeId || row.status === "archived") continue;
    const validUntil = dateOnly(row.valid_until);
    if (!validUntil) continue;
    if (validUntil < referenceDate) return "expired";
    if (validUntil <= limit30) expiring = true;
  }
  return expiring ? "expiring" : null;
}

function round(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function calculateLaborControl({
  month,
  referenceDate,
  projects,
  employments,
  assignments,
  timesheets,
  complianceItems
}: {
  month: string;
  referenceDate: string;
  projects: HrLaborRow[];
  employments: HrLaborRow[];
  assignments: HrLaborRow[];
  timesheets: HrLaborRow[];
  complianceItems: HrLaborRow[];
}): LaborControlResult {
  const bounds = monthBounds(month);
  const monthTimesheets = timesheets.filter((row) => dateOnly(row.work_date).startsWith(month));
  const monthAssignments = assignments.filter((row) => overlapDays(row, month) > 0);
  const approvedStatuses = new Set(["approved"]);
  const pendingStatuses = new Set(["draft", "pending", "submitted", "review"]);

  const projectCosts: LaborProjectCost[] = projects.map((project) => {
    const projectId = String(project.id);
    const projectAssignments = monthAssignments.filter((row) => String(row.project_id) === projectId);
    const projectTimesheets = monthTimesheets.filter((row) => String(row.project_id ?? "") === projectId);
    const employeeIds = new Set<string>([
      ...projectAssignments.map((row) => String(row.employee_id)),
      ...projectTimesheets.map((row) => String(row.employee_id))
    ]);

    const employeeCosts = Array.from(employeeIds).map((employeeId) => {
      const employeeAssignments = projectAssignments.filter((row) => String(row.employee_id) === employeeId);
      let allocationPercent = 0;
      let plannedHours = 0;
      let plannedCost = 0;
      for (const assignment of employeeAssignments) {
        const days = overlapDays(assignment, month);
        const employmentDate = dateOnly(assignment.date_from) > bounds.start ? dateOnly(assignment.date_from) : bounds.start;
        const employment = employmentForDate(employments, employeeId, employmentDate || bounds.start);
        const rate = hourlyEmployerCost(employment);
        const nominalHours = Number(employment?.nominal_monthly_hours ?? 168) || 168;
        const allocation = Math.max(0, Number(assignment.allocation_percent ?? 0));
        allocationPercent += allocation;
        const hours = nominalHours * (allocation / 100) * (days / bounds.days);
        plannedHours += hours;
        plannedCost += hours * rate;
      }

      const employeeTimesheets = projectTimesheets.filter((row) => String(row.employee_id) === employeeId);
      let approvedHours = 0;
      let overtimeHours = 0;
      let actualCost = 0;
      let pendingHours = 0;
      let pendingCost = 0;
      let lastRate = 0;
      for (const entry of employeeTimesheets) {
        const base = Number(entry.hours ?? 0);
        const overtime = Number(entry.overtime_hours ?? 0);
        const total = Math.max(0, base) + Math.max(0, overtime);
        const employment = employmentForDate(employments, employeeId, dateOnly(entry.work_date));
        const rate = hourlyEmployerCost(employment);
        if (rate > 0) lastRate = rate;
        const status = String(entry.status ?? "");
        if (approvedStatuses.has(status)) {
          approvedHours += Math.max(0, base);
          overtimeHours += Math.max(0, overtime);
          actualCost += total * rate;
        } else if (pendingStatuses.has(status)) {
          pendingHours += total;
          pendingCost += total * rate;
        }
      }

      const currentRate = hourlyEmployerCost(employmentForDate(employments, employeeId, referenceDate)) || lastRate;
      return {
        employeeId,
        allocationPercent: round(allocationPercent),
        plannedHours: round(plannedHours),
        plannedCost: round(plannedCost),
        approvedHours: round(approvedHours),
        overtimeHours: round(overtimeHours),
        actualCost: round(actualCost),
        pendingHours: round(pendingHours),
        pendingCost: round(pendingCost),
        hourlyCost: round(currentRate),
        hasAssignment: employeeAssignments.length > 0,
        complianceRisk: complianceRisk(complianceItems, employeeId, referenceDate)
      } satisfies LaborEmployeeCost;
    });

    const plannedHours = employeeCosts.reduce((sum, row) => sum + row.plannedHours, 0);
    const plannedCost = employeeCosts.reduce((sum, row) => sum + row.plannedCost, 0);
    const approvedHours = employeeCosts.reduce((sum, row) => sum + row.approvedHours, 0);
    const overtimeHours = employeeCosts.reduce((sum, row) => sum + row.overtimeHours, 0);
    const actualCost = employeeCosts.reduce((sum, row) => sum + row.actualCost, 0);
    const pendingHours = employeeCosts.reduce((sum, row) => sum + row.pendingHours, 0);
    const pendingCost = employeeCosts.reduce((sum, row) => sum + row.pendingCost, 0);
    const warnings: string[] = [];
    if (employeeCosts.some((row) => row.hourlyCost <= 0)) warnings.push("Brak kosztu 1 r-g u części zespołu");
    if (employeeCosts.some((row) => !row.hasAssignment && row.approvedHours + row.overtimeHours > 0)) warnings.push("Czas pracy bez formalnego przypisania");
    if (employeeCosts.some((row) => row.plannedHours > 0 && row.approvedHours + row.overtimeHours > row.plannedHours + 0.1)) warnings.push("Przekroczono plan godzin pracownika");
    if (employeeCosts.some((row) => row.complianceRisk === "expired")) warnings.push("Wygasłe BHP / badania / uprawnienia");
    else if (employeeCosts.some((row) => row.complianceRisk === "expiring")) warnings.push("BHP / badania / uprawnienia wygasają ≤30 dni");
    const overPlan = plannedCost > 0 && actualCost > plannedCost + 0.01;
    if (overPlan) warnings.push("Przekroczony plan kosztu robocizny");

    return {
      projectId,
      employeeCosts,
      people: employeeCosts.length,
      plannedHours: round(plannedHours),
      plannedCost: round(plannedCost),
      approvedHours: round(approvedHours),
      overtimeHours: round(overtimeHours),
      actualCost: round(actualCost),
      pendingHours: round(pendingHours),
      pendingCost: round(pendingCost),
      overPlan,
      warnings
    } satisfies LaborProjectCost;
  }).filter((row) => row.people > 0 || row.actualCost > 0 || row.pendingCost > 0);

  let unassignedApprovedHours = 0;
  let unassignedActualCost = 0;
  let unassignedPendingHours = 0;
  let unassignedPendingCost = 0;
  for (const entry of monthTimesheets.filter((row) => !row.project_id)) {
    const employeeId = String(entry.employee_id);
    const base = Math.max(0, Number(entry.hours ?? 0));
    const overtime = Math.max(0, Number(entry.overtime_hours ?? 0));
    const total = base + overtime;
    const rate = hourlyEmployerCost(employmentForDate(employments, employeeId, dateOnly(entry.work_date)));
    const status = String(entry.status ?? "");
    if (approvedStatuses.has(status)) {
      unassignedApprovedHours += total;
      unassignedActualCost += total * rate;
    } else if (pendingStatuses.has(status)) {
      unassignedPendingHours += total;
      unassignedPendingCost += total * rate;
    }
  }

  return {
    month,
    projects: projectCosts.sort((a, b) => b.actualCost - a.actualCost || b.plannedCost - a.plannedCost),
    actualCost: round(projectCosts.reduce((sum, row) => sum + row.actualCost, 0)),
    approvedHours: round(projectCosts.reduce((sum, row) => sum + row.approvedHours + row.overtimeHours, 0)),
    overtimeHours: round(projectCosts.reduce((sum, row) => sum + row.overtimeHours, 0)),
    pendingCost: round(projectCosts.reduce((sum, row) => sum + row.pendingCost, 0)),
    unassignedApprovedHours: round(unassignedApprovedHours),
    unassignedActualCost: round(unassignedActualCost),
    unassignedPendingHours: round(unassignedPendingHours),
    unassignedPendingCost: round(unassignedPendingCost),
    overPlanProjects: projectCosts.filter((row) => row.overPlan).length
  };
}
