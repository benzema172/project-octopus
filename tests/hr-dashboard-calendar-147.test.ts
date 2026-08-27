import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("HR dashboard calendar day status 1.4.7", () => {
  const page = readFileSync("app/workspace/companies/[workspaceId]/hr/page.tsx", "utf8");
  const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const calendar = readFileSync("components/company/hr/hr-dashboard-calendar-147.tsx", "utf8");
  const css = readFileSync("components/company/hr/hr-dashboard-calendar-147.module.css", "utf8");

  it("mounts the 1.4.7 calendar only under the HR dashboard wrapper", () => {
    expect(page).toContain("HrWorkspace147");
    expect(wrapper).toContain("HrWorkspace140");
    expect(wrapper).toContain("HrDashboardCalendar147");
    expect(wrapper).toContain("dashboardActive");
    expect(wrapper).toContain("data={props.data}");
  });

  it("derives daily employee status from real HR assignments, timesheets and approved leave", () => {
    expect(calendar).toContain("data.timesheets.filter");
    expect(calendar).toContain("data.assignments");
    expect(calendar).toContain("data.leaves.filter");
    expect(calendar).toContain('String(row.status) === "approved"');
    expect(calendar).toContain("sheetProjectIds.length ? sheetProjectIds : assignmentProjectIds");
    expect(calendar).toContain('"Brak wpisu czasu"');
    expect(calendar).toContain('statusLabel: "Urlop + wpis czasu"');
  });

  it("shows all employees in a sliding selected-day list with place and hours", () => {
    expect(calendar).toContain("data.employees.map");
    expect(calendar).toContain("Status pracowników");
    expect(calendar).toContain("Gdzie / inwestycja");
    expect(calendar).toContain("Godziny");
    expect(calendar).toContain("row.hours + row.overtime");
    expect(css).toContain("@keyframes drawerIn");
    expect(css).toContain(".employeeRow");
  });

  it("uses a clear color language for work, absence, missing entries and conflicts", () => {
    expect(calendar).toContain("Praca");
    expect(calendar).toContain("Nieobecność");
    expect(calendar).toContain("Brak wpisu");
    expect(calendar).toContain("Konflikt danych");
    expect(css).toContain(".legendWork");
    expect(css).toContain(".legendAbsence");
    expect(css).toContain(".legendMissing");
    expect(css).toContain(".legendConflict");
    expect(css).toContain(".stateBar");
  });
});
