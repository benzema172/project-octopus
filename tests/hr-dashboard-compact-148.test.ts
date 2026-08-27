import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("HR dashboard compact layout 1.4.8", () => {
  const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const wrapperCss = readFileSync("components/company/hr/hr-workspace-146.module.css", "utf8");
  const calendarCss = readFileSync("components/company/hr/hr-dashboard-calendar-147.module.css", "utf8");

  it("scopes compact dashboard styling only to the active Pulpit", () => {
    expect(wrapper).toContain("dashboardActive ? styles.dashboardCompact");
    expect(wrapperCss).toContain(".dashboardCompact .workspaceSlot");
  });

  it("removes helper descriptions from the dashboard cards and calendar", () => {
    expect(wrapperCss).toContain('[class*="grid2"] [class*="subtle"]');
    expect(wrapperCss).toContain('[class*="grid3"] [class*="subtle"]');
    expect(wrapperCss).toContain("display:none!important");
    expect(calendarCss).toContain(".titleBlock>div>p:not(.kicker){display:none}");
    expect(calendarCss).toContain(".monthBar span{display:none");
  });

  it("reduces vertical padding and gaps in the dashboard summary cards", () => {
    expect(wrapperCss).toContain("padding:11px 14px!important");
    expect(wrapperCss).toContain("margin-bottom:7px!important");
    expect(wrapperCss).toContain("padding:7px 9px!important");
    expect(calendarCss).toContain("padding:14px");
    expect(calendarCss).toContain("gap:10px");
  });
});
