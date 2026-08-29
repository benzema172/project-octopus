import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  countPolishWorkingDays,
  countPolishWorkingDaysInYear,
  isPolishWorkingDay,
  previousPolishWorkingDay
} from "../lib/hr/polish-work-calendar";

describe("Kadry 1.6 Polish work calendar", () => {
  const loader = readFileSync("lib/data/hr-workspace-140.ts", "utf8");
  const mainApi = readFileSync("app/api/company/hr/route.ts", "utf8");
  const legacyUi = readFileSync("components/company/hr/hr-workspace-140.tsx", "utf8");
  const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const registry = readFileSync("components/company/hr/hr-employee-registry-152.tsx", "utf8");

  it("recognizes Christmas Eve as a statutory day off from 2025, not retroactively", () => {
    expect(isPolishWorkingDay("2024-12-24")).toBe(true);
    expect(isPolishWorkingDay("2025-12-24")).toBe(false);
    expect(isPolishWorkingDay("2026-12-24")).toBe(false);
  });

  it("uses one Polish calendar for weekends and movable holidays", () => {
    expect(isPolishWorkingDay("2026-04-06")).toBe(false); // Poniedziałek Wielkanocny
    expect(isPolishWorkingDay("2026-06-04")).toBe(false); // Boże Ciało
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

  it("does not silently grant or preselect 26 days when entitlement is missing", () => {
    expect(loader).toContain("entitlement_configured: entitlementConfigured");
    expect(loader).toContain("remaining_days: total === null ? null");
    expect(loader).not.toContain("entitlement?.annual_days ?? 26");
    expect(legacyUi).toContain('placeholder="20 / 26 / inny"');
    expect(legacyUi).not.toContain('name="annualDays" inputMode="decimal" defaultValue="26"');
    expect(legacyUi).toContain('"Nie ustawiono"');
  });

  it("uses 7/14/30 day compliance escalation and exposes missing leave limits", () => {
    expect(loader).toContain("expiring7Items");
    expect(loader).toContain("expiring14Items");
    expect(loader).toContain("window_days: 7");
    expect(loader).toContain("window_days: 14");
    expect(loader).toContain("window_days: 30");
    expect(loader).toContain('type: "leave_entitlement"');
    expect(legacyUi).toContain("≤7 dni");
    expect(legacyUi).toContain("≤14 dni");
    expect(wrapper).toContain('type === "leave_entitlement"');
  });

  it("loads only audit metadata and shows employee-scoped history", () => {
    expect(loader).toContain('db.from("audit_events").select("id,event_type,entity_type,entity_id,actor_type,created_at")');
    expect(loader).not.toContain('db.from("audit_events").select("*")');
    expect(registry).toContain("Historia zmian");
    expect(registry).toContain('String(row.entity_type) === "employee"');
    expect(mainApi).toContain('"leave_entitlement_upserted"');
    expect(mainApi).toContain('"medical_exam_created"');
    expect(mainApi).toContain('"safety_training_created"');
    expect(mainApi).toContain('"qualification_created"');
  });

  it("puts dashboard action semantics in the native legacy alert markup", () => {
    expect(legacyUi).toContain("data-hr-action-index={index}");
    expect(legacyUi).toContain('role="button"');
    expect(legacyUi).toContain("tabIndex={0}");
  });
});
