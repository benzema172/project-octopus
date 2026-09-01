import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateLaborControl } from "../lib/hr/labor-cost-control";

describe("Project Octopus HR hybrid settlement model", () => {
  it("uses the operational hourly rate as the investment labor cost", () => {
    const result = calculateLaborControl({
      month: "2026-08",
      referenceDate: "2026-08-28",
      projects: [{ id: "p1", name: "Wysoka" }],
      employments: [{ employee_id: "e1", valid_from: "2026-08-01", settlement_model: "hourly_with_monthly_base", operational_net_hourly_rate: 30, hourly_cost: 30, monthly_cost: 6200, net_monthly_pay: 4000, gross_monthly_pay: 5100, nominal_monthly_hours: 160 }],
      assignments: [{ employee_id: "e1", project_id: "p1", date_from: "2026-08-01", allocation_percent: 100 }],
      timesheets: [{ employee_id: "e1", project_id: "p1", work_date: "2026-08-20", hours: 160, overtime_hours: 0, status: "approved" }],
      complianceItems: []
    });
    expect(result.projects[0]?.actualCost).toBe(4800);
    expect(result.projects[0]?.employeeCosts[0]?.hourlyCost).toBe(30);
    expect(result.projects[0]?.plannedCost).toBe(4800);
  });

  it("keeps the settlement selector inside the current atomic employee form", () => {
    const fields = readFileSync("components/company/hr/hr-compensation-fields-150.tsx", "utf8");
    const create = readFileSync("components/company/hr/hr-employee-create-300.tsx", "utf8");
    const endpoint = readFileSync("app/api/company/hr/employee-compensation/route.ts", "utf8");
    expect(fields).toContain('name="settlementModel"');
    expect(fields).toContain('value="hourly_with_monthly_base"');
    expect(fields).toContain('name="operationalNetHourlyRate"');
    expect(fields).toContain("Stawka używana w inwestycjach");
    expect(create).toContain("HrCompensationFields150");
    expect(create).toContain("/api/company/hr/employee-bundle");
    expect(endpoint).toContain("operational_net_hourly_rate");
    expect(endpoint).toContain("hourly_cost: operationalRate");
  });

  it("keeps hybrid investment rate protected at database level and finance reads the shared hourly cost", () => {
    const migration = readFileSync("supabase/migrations/20260828113600_hr_hybrid_settlement_model_157.sql", "utf8");
    const laborFinance = readFileSync("lib/data/project-labor-finance.ts", "utf8");
    expect(migration).toContain("hourly_with_monthly_base");
    expect(migration).toContain("new.hourly_cost := new.operational_net_hourly_rate");
    expect(migration).toContain("trg_hr_apply_investment_hourly_rate_157");
    expect(laborFinance).toContain("hourlyEmployerCost(employment)");
  });
});
