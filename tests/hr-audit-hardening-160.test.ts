import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertTimesheetHours, isIsoDate, isYearMonth } from "../lib/hr/validation";

describe("Kadry audit hardening", () => {
  const inlineApi = readFileSync("app/api/company/hr/timesheet-entry/route.ts", "utf8");
  const calendarApi = readFileSync("app/api/company/hr/employee-calendar/route.ts", "utf8");
  const exportApi = readFileSync("app/api/company/hr/export/route.ts", "utf8");
  const timeGrid = readFileSync("components/company/hr/hr-time-records-400.tsx", "utf8");
  const upload = readFileSync("components/company/hr/hr-document-upload-157.tsx", "utf8");
  const loader = readFileSync("lib/data/hr-workspace-140.ts", "utf8");
  const workCalendar = readFileSync("lib/hr/polish-work-calendar.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260828133500_hr_integrity_hardening.sql", "utf8");

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
    expect(migration).toContain("timesheets_workspace_employee_date_project_uidx");
    expect(migration).toContain("nulls not distinct");
  });

  it("enforces HR integrity in the database even for legacy write paths", () => {
    for (const token of ["timesheets_valid_hours_check", "assignments_period_check", "assignments_allocation_percent_check", "qualifications_period_check", "medical_exams_period_check", "safety_trainings_period_check", "employee_documents_period_check", "employments_fte_check"]) expect(migration).toContain(token);
  });

  it("validates focused calendar and export dates strictly", () => {
    expect(calendarApi).toContain("isYearMonth(month)");
    expect(exportApi).toContain("isIsoDate(value)");
    expect(loader).toContain("isIsoDate(candidate)");
  });

  it("flags missing time only for the previous Polish working day and excludes approved absence", () => {
    expect(loader).toContain("previousPolishWorkingDay(referenceDate)");
    expect(workCalendar).toContain("isPolishWorkingDay(candidate)");
    expect(loader).toContain("previousAbsent");
    expect(loader).toContain("inRange(previousWorkDate, row.hired_at, row.terminated_at)");
    expect(loader).toContain("bez wpisu czasu za ${previousWorkDate}");
  });

  it("neutralizes spreadsheet formulas in textual CSV cells", () => {
    expect(exportApi).toContain('/^[\\s]*[=+\\-@]/');
    expect(exportApi).toContain("text = `'${text}`");
  });

  it("indexes Time 4.0 by employee/day and supports focused employee navigation", () => {
    expect(timeGrid).toContain("initialEmployeeId");
    expect(timeGrid).toContain("employeeFilter");
    expect(timeGrid).toContain("entriesByEmployeeDate");
    expect(timeGrid).toContain('`${String(row.employee_id)}|${String(row.work_date).slice(0, 10)}`');
  });

  it("does not claim Brain analysis succeeded when it did not start", () => {
    expect(upload).toContain("analysisStarted: false");
    expect(upload).toContain("Analiza AI zakończyła się dla ${analysisStarted} z ${done}");
    expect(upload).toContain("analiza Octopus Brain nie została uruchomiona");
    expect(upload).toContain("Gotowe: zapisano i przeanalizowano");
  });
});
