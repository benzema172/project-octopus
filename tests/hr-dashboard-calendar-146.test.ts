import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("HR dashboard calendar 1.4.6", () => {
  const page = readFileSync("app/workspace/companies/[workspaceId]/hr/page.tsx", "utf8");
  const wrapper = readFileSync("components/company/hr/hr-workspace-146.tsx", "utf8");
  const wrapperCss = readFileSync("components/company/hr/hr-workspace-146.module.css", "utf8");
  const calendar = readFileSync("components/company/hr/hr-dashboard-calendar-146.tsx", "utf8");
  const calendarCss = readFileSync("components/company/hr/hr-dashboard-calendar-146.module.css", "utf8");

  it("uses the 1.4.6 HR workspace while preserving the existing HR engine", () => {
    expect(page).toContain("HrWorkspace146");
    expect(page).not.toContain("<HrWorkspace140");
    expect(wrapper).toContain("HrWorkspace140");
    expect(wrapper).toContain("HrDashboardCalendar146");
  });

  it("removes the legacy KPI row from the rendered dashboard and keeps other tabs intact", () => {
    expect(wrapperCss).toContain('section[class*="metrics"]');
    expect(wrapperCss).toContain("display:none!important");
    expect(wrapper).toContain('aria-label="Sekcje modułu Kadry"');
    expect(wrapper).toContain("dashboardActive");
  });

  it("renders a dynamic clickable 42-day monthly calendar", () => {
    expect(calendar).toContain("Array.from({ length: 42 }");
    expect(calendar).toContain("setSelectedDate(value)");
    expect(calendar).toContain("addMonths(current, -1)");
    expect(calendar).toContain("addMonths(current, 1)");
    expect(calendar).toContain("Kalendarz miesięczny");
    expect(calendar).toContain('role="gridcell"');
    expect(calendarCss).toContain("grid-template-columns:repeat(7");
    expect(calendarCss).toContain(".selected");
    expect(calendarCss).toContain(".today");
  });
});
