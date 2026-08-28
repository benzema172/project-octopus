import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateCompensation, compensationBurden } from "../lib/hr/compensation";

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Kadry 1.5.0 — wynagrodzenia i pełny koszt pracodawcy", () => {
  it("calculates the employer total and effective hourly cost from the detailed breakdown", () => {
    const result = calculateCompensation({
      netMonthlyPay: 6_200,
      grossMonthlyPay: 8_600,
      employerContributions: 1_760,
      otherMonthlyCosts: 300,
      nominalMonthlyHours: 168
    });

    expect(result.totalEmployerCost).toBe(10_660);
    expect(result.effectiveHourlyCost).toBe(63.4524);
    expect(result.hasDetailedBreakdown).toBe(true);
    expect(compensationBurden({ netMonthlyPay: 6_200, grossMonthlyPay: 8_600, employerContributions: 1_760, otherMonthlyCosts: 300 })).toBe(4_460);
  });

  it("preserves legacy monthly and hourly costs when no breakdown exists", () => {
    expect(calculateCompensation({ legacyMonthlyCost: 10_000, legacyHourlyCost: 62.5 })).toMatchObject({
      totalEmployerCost: 10_000,
      effectiveHourlyCost: 62.5,
      hasDetailedBreakdown: false
    });
  });

  it("adds protected monthly payroll storage and backward-compatible employment creation", () => {
    const migration = read("supabase/migrations/20260828110000_hr_payroll_cost_control_150.sql");
    const policyHardening = read("supabase/migrations/20260828111500_hr_payroll_rls_policy_hardening_150.sql");
    expect(migration).toContain("create table if not exists public.employee_payroll_months");
    expect(migration).toContain("net_monthly_pay");
    expect(migration).toContain("employer_contributions");
    expect(migration).toContain("employee_payroll_months_read");
    expect(migration).toContain("finance', 'read'");
    expect(migration).toContain("grant select, insert, update, delete on table public.employee_payroll_months to service_role");
    expect(migration.match(/create or replace function public\.create_employment_atomic/g)).toHaveLength(2);
    expect(policyHardening).toContain("drop policy if exists employee_payroll_months_manage");
    expect(policyHardening).toContain("for insert to authenticated");
    expect(policyHardening).toContain("for update to authenticated");
    expect(policyHardening).toContain("for delete to authenticated");
  });

  it("connects the employee form, profile, dashboard, API and export", () => {
    const workspace = read("components/company/hr/hr-workspace-140.tsx");
    const fields = read("components/company/hr/hr-compensation-fields-150.tsx");
    const route = read("app/api/company/hr/route.ts");
    const exportRoute = read("app/api/company/hr/export/route.ts");
    expect(fields).toContain('name="netMonthlyPay"');
    expect(fields).toContain('name="grossMonthlyPay"');
    expect(fields).toContain('name="employerContributions"');
    expect(workspace).toContain("Rozliczenia miesięczne");
    expect(workspace).toContain("Pełny koszt zatrudnienia");
    expect(route).toContain('"payroll_upsert"');
    expect(route).toContain('"payroll_status"');
    expect(exportRoute).toContain("canViewPayroll");
  });
});
