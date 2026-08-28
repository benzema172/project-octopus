import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry employee leave entitlement integration", () => {
  const createForm = readFileSync("components/company/hr/hr-employee-create-153.tsx", "utf8");
  const registry = readFileSync("components/company/hr/hr-employee-registry-152.tsx", "utf8");
  const route = readFileSync("app/api/company/hr/route.ts", "utf8");

  it("allows setting the current-year leave entitlement while creating an employee", () => {
    expect(createForm).toContain("Dni wolne i urlop");
    expect(createForm).toContain('name="leaveAnnualDays"');
    expect(createForm).toContain('name="leaveCarriedOverDays"');
    expect(createForm).toContain('name="leaveExtraDays"');
    expect(createForm).toContain('postHr("leave_entitlement_upsert"');
  });

  it("loads and updates the same entitlement from the employee card", () => {
    expect(registry).toContain("entitlements?: Row[]");
    expect(registry).toContain("currentEntitlement");
    expect(registry).toContain('postHrAction("leave_entitlement_upsert"');
    expect(registry).toContain("Limit dni wolnych zsynchronizowano z „Urlopy i absencje”.");
  });

  it("uses the canonical leave_entitlements registry already managed by Urlopy i absencje", () => {
    expect(route).toContain('body.action === "leave_entitlement_upsert"');
    expect(route).toContain('db.from("leave_entitlements").upsert');
    expect(route).toContain('onConflict: "workspace_id,employee_id,year"');
  });
});
