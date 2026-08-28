import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertTimesheetHours, isIsoDate, isYearMonth } from "../lib/hr/validation";

describe("Kadry 1.6.0 audit hardening", () => {
  const inlineApi = readFileSync("app/api/company/hr/timesheet-entry/route.ts", "utf8");
  const calendarApi = readFileSync("app/api/company/hr/employee-calendar/route.ts", "utf8");
  const exportApi = readFileSync("app/api/company/hr/export/route.ts", "utf8");
  const timeGrid = readFileSync("components/company/hr/hr-time-records-159.tsx", "utf8");
  const upload = readFileSync("components/company/hr/hr-document-upload-157.tsx", "utf8");

  it("rejects impossible dates and impossible year-month values", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isYearMonth("2026-12")).toBe(true);
    expect(isYearMonth("2026-00")).toBe(false);
    expect(isYearMonth("2026-99")).toBe(false);
  });

  it("rejects impossible daily working-hour totals", () => {
    expect(() => assertTimesheetHours(8, 2)).not.toThrow();
    expect(() => assertTimesheetHours(20, 5)).toThrow(/24 h/);
    expect(() => assertTimesheetHours(0, 0)).toThrow(/większe od zera/);
    expect(() => assertTimesheetHours(8, -1)).toThrow(/24 h/);
  });

  it("prevents duplicate inline entries for the same employee, day and investment", () => {
    expect(inlineApi).toContain("ensureUniqueEntry");
    expect(inlineApi).toContain('query.is("project_id", null)');
    expect(inlineApi).toContain('query.neq("id", excludeId)');
    expect(inlineApi).toContain("istnieje już wpis");
    expect(inlineApi).toContain("assertTimesheetHours(hours, overtime)");
  });

  it("validates focused calendar and export dates strictly", () => {
    expect(calendarApi).toContain("isYearMonth(month)");
    expect(exportApi).toContain("isIsoDate(value)");
  });

  it("neutralizes spreadsheet formulas in textual CSV cells", () => {
    expect(exportApi).toContain('/^[\\s]*[=+\\-@]/');
    expect(exportApi).toContain("text = `'${text}`");
  });

  it("exports only the focused employee and indexes the time grid", () => {
    expect(timeGrid).toContain('params.set("employeeId", employeeId)');
    expect(timeGrid).toContain("entriesByEmployeeDate");
    expect(timeGrid).toContain('entriesByEmployeeDate.get(`${employeeId}|${date}`)');
  });

  it("does not claim Brain analysis succeeded when it did not start", () => {
    expect(upload).toContain("analysisStarted: false");
    expect(upload).toContain("Analiza AI ruszyła dla");
    expect(upload).toContain("analiza Octopus Brain nie została uruchomiona");
  });
});
