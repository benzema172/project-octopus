import { describe, expect, it } from "vitest";
import { calculateLaborControl, type HrLaborRow } from "../lib/hr/labor-cost-control";

const project = { id: "p1", name: "Wysoka" } satisfies HrLaborRow;
const employment = {
  id: "em1",
  employee_id: "e1",
  valid_from: "2026-01-01",
  valid_to: null,
  hourly_cost: 40,
  monthly_cost: 8200,
  nominal_monthly_hours: 168
} satisfies HrLaborRow;

function calculate(overrides: {
  assignments?: HrLaborRow[];
  timesheets?: HrLaborRow[];
  employments?: HrLaborRow[];
} = {}) {
  return calculateLaborControl({
    month: "2026-09",
    referenceDate: "2026-09-01",
    projects: [project],
    employments: overrides.employments ?? [employment],
    assignments: overrides.assignments ?? [],
    timesheets: overrides.timesheets ?? [],
    complianceItems: []
  });
}

describe("HR labor control 4.1", () => {
  it("shows submitted project time as pending cost without pretending it is actual", () => {
    const result = calculate({
      timesheets: [{
        id: "t1",
        employee_id: "e1",
        project_id: "p1",
        work_date: "2026-09-01",
        hours: 8,
        overtime_hours: 0,
        status: "submitted",
        hourly_cost_snapshot: 40,
        labor_cost_snapshot: 320
      }]
    });

    expect(result.actualCost).toBe(0);
    expect(result.approvedHours).toBe(0);
    expect(result.pendingHours).toBe(8);
    expect(result.pendingCost).toBe(320);
    expect(result.projectedCost).toBe(320);
    expect(result.plannedCost).toBe(0);
    expect(result.withoutFormalAssignmentPeople).toBe(1);
    expect(result.projects[0]?.warnings.join(" ")).toContain("bez formalnego przypisania");
  });

  it("turns a full-month formal assignment into a labor plan without booking actual cost", () => {
    const result = calculate({
      assignments: [{
        id: "a1",
        employee_id: "e1",
        project_id: "p1",
        date_from: "2026-09-01",
        date_to: null,
        allocation_percent: 100
      }]
    });

    expect(result.plannedHours).toBe(168);
    expect(result.plannedCost).toBe(6720);
    expect(result.actualCost).toBe(0);
    expect(result.formalAssignmentPeople).toBe(1);
    expect(result.assignedWithoutTimePeople).toBe(1);
  });

  it("moves approved time into actual cost and removes it from pending cost", () => {
    const result = calculate({
      timesheets: [{
        id: "t1",
        employee_id: "e1",
        project_id: "p1",
        work_date: "2026-09-01",
        hours: 8,
        overtime_hours: 0,
        status: "approved",
        hourly_cost_snapshot: 40,
        labor_cost_snapshot: 320
      }]
    });

    expect(result.approvedHours).toBe(8);
    expect(result.actualCost).toBe(320);
    expect(result.pendingHours).toBe(0);
    expect(result.pendingCost).toBe(0);
  });

  it("flags a projected plan overrun before submitted time is approved", () => {
    const result = calculate({
      assignments: [{
        id: "a1",
        employee_id: "e1",
        project_id: "p1",
        date_from: "2026-09-01",
        date_to: null,
        allocation_percent: 25
      }],
      timesheets: [{
        id: "t1",
        employee_id: "e1",
        project_id: "p1",
        work_date: "2026-09-01",
        hours: 50,
        overtime_hours: 0,
        status: "submitted",
        hourly_cost_snapshot: 40,
        labor_cost_snapshot: 2000
      }]
    });

    expect(result.projects[0]?.plannedCost).toBe(1680);
    expect(result.projects[0]?.actualCost).toBe(0);
    expect(result.projects[0]?.projectedCost).toBe(2000);
    expect(result.projects[0]?.overPlan).toBe(false);
    expect(result.projects[0]?.projectedOverPlan).toBe(true);
    expect(result.projectedOverPlanProjects).toBe(1);
  });

  it("keeps the UI contract explicit about approved, pending and planned labor", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("components/company/hr/hr-team-cost-control-156.tsx", "utf8");
    expect(source).toContain("Koszt zatwierdzony");
    expect(source).toContain("Do zatwierdzenia");
    expect(source).toContain("Plan robocizny");
    expect(source).toContain("Szybkie formalne przypisanie pracownika do inwestycji");
    expect(source).toContain("godzinowo + podstawa");
  });
});
