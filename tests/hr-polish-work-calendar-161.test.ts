import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countPolishWorkingDays, countPolishWorkingDaysInYear, isPolishWorkingDay, previousPolishWorkingDay } from "../lib/hr/polish-work-calendar";

describe("Kadry Core 3.0 — polski kalendarz pracy", () => {
  const loader = readFileSync("lib/data/hr-workspace-140.ts", "utf8");
  const mainApi = readFileSync("app/api/company/hr/route.ts", "utf8");
  const dashboard = readFileSync("components/company/hr/hr-dashboard-core-300.tsx", "utf8");
  const issueEngine = readFileSync("lib/hr/employee-issues.ts", "utf8");

  it("recognizes Christmas Eve as a statutory day off from 2025, not retroactively", () => {
    expect(isPolishWorkingDay("2024-12-24")).toBe(true);
    expect(isPolishWorkingDay("2025-12-24")).toBe(false);
    expect(isPolishWorkingDay("2026-12-24")).toBe(false);
  });

  it("uses one Polish calendar for weekends and movable holidays", () => {
    expect(isPolishWorkingDay("2026-04-06")).toBe(false);
    expect(isPolishWorkingDay("2026-06-04")).toBe(false);
    expect(countPolishWorkingDays("2026-04-03", "2026-04-07")).toBe(2);
    expect(mainApi).toContain("countPolishWorkingDays(from, to)");
    expect(mainApi).not.toContain("function workingDaysPl");
  });

  it("finds the previous real working day across Christmas holidays", () => {
    expect(previousPolishWorkingDay("2026-12-28")).toBe("2026-12-23");
  });

  it("splits annual leave usage correctly across calendar years", () => {
    expect(countPolishWorkingDaysInYear("2026-12-30", "2027-01-04", 2026)).toBe(2);
    expect(countPolishWorkingDaysInYear("2026-12-30", "2027-01-04", 2027)).toBe(1);
  });

  it("does not silently grant 26 days when entitlement is missing", () => {
    expect(loader).toContain("entitlement_configured: entitlementConfigured");
    expect(loader).toContain("remaining_days: total === null ? null");
    expect(loader).not.toContain("entitlement?.annual_days ?? 26");
    expect(issueEngine).toContain("Brak limitu urlopu");
  });

  it("keeps compliance and employee issues actionable in the current dashboard", () => {
    expect(loader).toContain("expiring7Items");
    expect(loader).toContain("expiring14Items");
    expect(loader).toContain("window_days: 7");
    expect(loader).toContain("window_days: 14");
    expect(loader).toContain("window_days: 30");
    expect(dashboard).toContain("Centrum problemów pracownika");
    expect(dashboard).toContain("onNavigate(issue.targetTab, issue.employeeId)");
    expect(issueEngine).toContain("days <= 30");
  });
});
