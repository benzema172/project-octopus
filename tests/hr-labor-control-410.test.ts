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

describe("HR labor control automatic cost 4.3", () => {
  it("counts a saved workday on Wysoka immediately as actual labor cost", () => {
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
    expect(result.projects[0]?.approvedHours).toBe(8);
    expect(result.projects[0]?.actualCost).toBe(320);
    expect(result.pendingHours).toBe(0);
    expect(result.pendingCost).toBe(0);
    expect(result.withoutFormalAssignmentPeople).toBe(1);
  });

  it("keeps formal assignment as a planning tool without booking future actual cost", () => {
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

  it("uses the saved snapshot so a workday remains 8 h and 320 zł", () => {
    const result = calculate({
      assignments: [{
        id: "a1",
        employee_id: "e1",
        project_id: "p1",
        date_from: "2026-09-01",
        date_to: null,
        allocation_percent: 100
      }],
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

    expect(result.actualCost).toBe(320);
    expect(result.approvedHours).toBe(8);
    expect(result.projects[0]?.actualCost).toBe(320);
    expect(result.projects[0]?.plannedCost).toBe(6720);
  });

  it("flags actual cost above plan without a second approval stage", () => {
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
        status: "approved",
        hourly_cost_snapshot: 40,
        labor_cost_snapshot: 2000
      }]
    });

    expect(result.projects[0]?.plannedCost).toBe(1680);
    expect(result.projects[0]?.actualCost).toBe(2000);
    expect(result.projects[0]?.overPlan).toBe(true);
    expect(result.overPlanProjects).toBe(1);
  });

  it("keeps planning optional and hidden until a plan exists", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("components/company/hr/hr-team-cost-control-430.tsx", "utf8");
    expect(source).toContain("Koszt rzeczywisty");
    expect(source).toContain("Roboczogodziny");
    expect(source).toContain("Planowanie zespołu");
    expect(source).toContain("const hasAnyPlan");
    expect(source).toContain("const projectHasPlan");
    expect(source).toContain('data-plan-visible={hasAnyPlan ? "1" : "0"}');
    expect(source).toContain('data-project-has-plan={projectHasPlan ? "1" : "0"}');
    expect(source).not.toContain("Do zatwierdzenia");
  });
});
