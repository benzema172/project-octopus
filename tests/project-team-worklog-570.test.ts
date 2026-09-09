import { describe, expect, it } from "vitest";
import {
  normalizeTeamMonth570,
  shiftTeamMonth570,
  summarizeProjectTimesheets570,
  teamMonthBounds570,
  type ProjectTimesheetRow570
} from "../lib/investments/project-team-worklog-570";

describe("Project team worklog 5.7", () => {
  it("keeps a valid selected month and builds an exclusive next-month range", () => {
    expect(normalizeTeamMonth570("2026-09", new Date("2026-01-01T00:00:00Z"))).toBe("2026-09");
    expect(teamMonthBounds570("2026-09")).toEqual({ start: "2026-09-01", endExclusive: "2026-10-01" });
    expect(shiftTeamMonth570("2026-09", -1)).toBe("2026-08");
    expect(shiftTeamMonth570("2026-12", 1)).toBe("2027-01");
  });

  it("falls back to the current month for malformed filters", () => {
    expect(normalizeTeamMonth570("wrzesień", new Date("2026-09-09T12:00:00Z"))).toBe("2026-09");
    expect(normalizeTeamMonth570("2026-13", new Date("2026-09-09T12:00:00Z"))).toBe("2026-09");
  });

  it("turns the Wysoka-style 16 hour KPI into employee and day detail", () => {
    const rows: ProjectTimesheetRow570[] = [
      { id: "1", employee_id: "employee-1", work_date: "2026-09-09", hours: "8.00", overtime_hours: "0.00", status: "approved" },
      { id: "2", employee_id: "employee-1", work_date: "2026-09-01", hours: "8.00", overtime_hours: "0.00", status: "approved" }
    ];
    const summary = summarizeProjectTimesheets570(rows, new Map([["employee-1", "Pracownik testowy"]]));

    expect(summary.entryCount).toBe(2);
    expect(summary.employeeCount).toBe(1);
    expect(summary.workDays).toBe(2);
    expect(summary.totalHours).toBe(16);
    expect(summary.approvedHours).toBe(16);
    expect(summary.employees[0]).toMatchObject({
      employeeName: "Pracownik testowy",
      days: 2,
      totalHours: 16,
      firstDate: "2026-09-01",
      lastDate: "2026-09-09"
    });
  });

  it("separates approved hours from all registered hours and preserves overtime", () => {
    const rows: ProjectTimesheetRow570[] = [
      { id: "1", employee_id: "a", work_date: "2026-09-01", hours: 8, overtime_hours: 2, status: "approved" },
      { id: "2", employee_id: "b", work_date: "2026-09-02", hours: 6, overtime_hours: 0, status: "submitted" }
    ];
    const summary = summarizeProjectTimesheets570(rows, new Map([["a", "Anna"], ["b", "Bartek"]]));

    expect(summary.totalHours).toBe(16);
    expect(summary.approvedHours).toBe(10);
    expect(summary.employeeCount).toBe(2);
    expect(summary.workDays).toBe(2);
    expect(summary.employees.find((employee) => employee.employeeId === "a")?.overtimeHours).toBe(2);
  });
});
