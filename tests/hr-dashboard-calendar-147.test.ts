import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("HR dashboard editable calendar day status", () => {
  const page = readFileSync("app/workspace/companies/[workspaceId]/hr/page.tsx", "utf8");
  const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const calendar = readFileSync("components/company/hr/hr-dashboard-calendar-159.tsx", "utf8");
  const css = readFileSync("components/company/hr/hr-dashboard-calendar-147.module.css", "utf8");

  it("mounts the editable calendar only under the HR dashboard wrapper", () => {
    expect(page).toContain("HrWorkspace147");
    expect(wrapper).toContain("HrWorkspace140");
    expect(wrapper).toContain("HrDashboardCalendar159");
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

  it("shows all employees in a sliding selected-day list with investment and editable hours", () => {
    expect(calendar).toContain("data.employees.map");
    expect(calendar).toContain("Status pracowników");
    expect(calendar).toContain("Inwestycja / edycja");
    expect(calendar).toContain("Godziny");
    expect(calendar).toContain('variant="inline"');
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

  it("keeps the status legend in the selected-day panel instead of above the month grid", () => {
    const drawerIndex = calendar.indexOf("styles.dayDrawer");
    const legendIndex = calendar.indexOf('aria-label="Legenda statusów kalendarza"');
    const monthTitleIndex = calendar.indexOf("styles.monthTitle");
    expect(monthTitleIndex).toBeGreaterThan(calendar.indexOf("styles.titleBlock"));
    expect(monthTitleIndex).toBeLessThan(calendar.indexOf("styles.controls"));
    expect(drawerIndex).toBeGreaterThan(monthTitleIndex);
    expect(legendIndex).toBeGreaterThan(drawerIndex);
    expect(calendar.match(/aria-label=\"Legenda statusów kalendarza\"/g)).toHaveLength(1);
  });

  it("places day counters on the lower status row next to the legend", () => {
    const statusRowIndex = calendar.indexOf("styles.drawerStatusRow");
    const summaryIndex = calendar.indexOf("styles.summaryChips");
    const legendIndex = calendar.indexOf('aria-label="Legenda statusów kalendarza"');
    expect(statusRowIndex).toBeGreaterThan(calendar.indexOf("styles.drawerHeader"));
    expect(summaryIndex).toBeGreaterThan(statusRowIndex);
    expect(legendIndex).toBeGreaterThan(summaryIndex);
    expect(css).toContain(".drawerHeader{display:flex;align-items:flex-end");
    expect(css).toContain(".drawerStatusRow{display:flex");
  });
});
