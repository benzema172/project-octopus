import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainApi = readFileSync("app/api/company/hr/route.ts", "utf8");
const employeeApi = readFileSync("app/api/company/hr/employee/route.ts", "utf8");
const calendarApi = readFileSync("app/api/company/hr/employee-calendar/route.ts", "utf8");
const compensationApi = readFileSync("app/api/company/hr/employee-compensation/route.ts", "utf8");
const exportApi = readFileSync("app/api/company/hr/export/route.ts", "utf8");
const timesheetApi = readFileSync("app/api/company/hr/timesheet-entry/route.ts", "utf8");

describe("Kadry permission matrix", () => {
  it("requires an active workspace membership before every focused HR operation", () => {
    for (const source of [mainApi, employeeApi, calendarApi, compensationApi, exportApi, timesheetApi]) {
      expect(source).toContain("getWorkspaceForUser");
      expect(source).toContain("Brak dostępu do firmy.");
    }
  });

  it("separates HR read, write and approve capabilities", () => {
    expect(calendarApi).toContain('domain: "hr", level: "read"');
    expect(exportApi).toContain('domain: "hr", level: "read"');
    expect(timesheetApi).toContain('domain: "hr", level: "write"');
    expect(mainApi).toContain('domain: "hr", level: "write"');
    expect(mainApi).toContain('domain: "hr", level: "approve"');
    expect(employeeApi).toContain('domain: "hr", level: "approve"');
  });

  it("protects payroll changes behind HR approval or Finance access", () => {
    expect(mainApi).toContain("const canManagePayroll = hrApprove || financeWrite");
    expect(employeeApi).toContain("const canManagePayroll = hrApprove || financeWrite");
    expect(compensationApi).toContain("if (!hrApprove && !financeWrite)");
    expect(exportApi).toContain("const canViewPayroll = canHrApprove || canFinanceRead");
  });

  it("checks entity ownership inside the active workspace before writes", () => {
    expect(mainApi).toContain('.eq("workspace_id", workspace.id).eq("id", id)');
    expect(timesheetApi).toContain('.eq("workspace_id", workspace.id)');
    expect(calendarApi).toContain('.eq("employee_id", employeeId)');
    expect(employeeApi).toContain('.eq("workspace_id", workspaceId).eq("employee_id", employeeId)');
    expect(employeeApi).toContain('.eq("workspace_id", workspace.id)');
  });

  it("uses the shared Polish calendar and strict date/hour validation in the legacy write API", () => {
    expect(mainApi).toContain('countPolishWorkingDays(from, to)');
    expect(mainApi).toContain('if (!isIsoDate(result))');
    expect(mainApi).toContain('if (!isYearMonth(period))');
    expect(mainApi).toContain('assertTimesheetHours(hours, overtime)');
    expect(mainApi).not.toContain("function workingDaysPl");
  });
});
