import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHrEmployeeIssues } from "../lib/hr/employee-issues";
import type { HrWorkspaceData } from "../lib/hr/types";

function data(overrides: Partial<HrWorkspaceData> = {}): HrWorkspaceData {
  return {
    referenceDate: "2026-08-31", year: 2026,
    employees: [{ id: "e1", first_name: "Jan", last_name: "Monter", status: "active" }], projects: [], employments: [], payrollMonths: [], qualifications: [], exams: [], trainings: [], leaves: [], timesheets: [], assignments: [], teams: [], teamMembers: [], documents: [], employeeDocuments: [], unlinkedDocuments: [], entitlements: [], leaveBalances: [], issuedAssets: [], complianceItems: [], projectStaff: [], auditEvents: [], alerts: [], summary: {},
    ...overrides
  };
}

describe("HR Core 3.0 issue center", () => {
  it("detects missing employment, contract, medical, BHP and leave entitlement", () => {
    const result = buildHrEmployeeIssues(data());
    const kinds = new Set(result.issues.map((row) => row.kind));
    expect(kinds.has("employment")).toBe(true);
    expect(kinds.has("contract")).toBe(true);
    expect(kinds.has("medical")).toBe(true);
    expect(kinds.has("safety")).toBe(true);
    expect(kinds.has("leave")).toBe(true);
    expect(result.critical).toBeGreaterThanOrEqual(3);
  });

  it("detects over-allocation, pending decisions and negative leave balance", () => {
    const result = buildHrEmployeeIssues(data({
      employments: [{ id: "em1", employee_id: "e1", valid_from: "2026-01-01", monthly_cost: 9000, hourly_cost: 60 }],
      assignments: [{ employee_id: "e1", date_from: "2026-01-01", allocation_percent: 70 }, { employee_id: "e1", date_from: "2026-02-01", allocation_percent: 50 }],
      leaves: [{ employee_id: "e1", status: "pending" }],
      timesheets: [{ employee_id: "e1", status: "submitted" }],
      leaveBalances: [{ employee_id: "e1", entitlement_configured: true, remaining_days: -2 }],
      exams: [{ employee_id: "e1", valid_until: "2027-01-01", status: "valid" }],
      trainings: [{ employee_id: "e1", valid_until: "2027-01-01", status: "valid" }]
    }), { canViewPayroll: true });
    expect(result.issues.some((row) => row.kind === "allocation")).toBe(true);
    expect(result.issues.some((row) => row.kind === "timesheet")).toBe(true);
    expect(result.issues.filter((row) => row.kind === "leave").length).toBeGreaterThanOrEqual(2);
  });
});

describe("HR Core 3.0 architecture contracts", () => {
  const shell = readFileSync("components/company/hr/hr-workspace-core-300.tsx", "utf8");
  const wrapper = readFileSync("components/company/hr/hr-workspace-149.tsx", "utf8");
  const create = readFileSync("components/company/hr/hr-employee-create-300.tsx", "utf8");
  const registry = readFileSync("components/company/hr/hr-employee-registry-300.tsx", "utf8");
  const createRoute = readFileSync("app/api/company/hr/employee-bundle/route.ts", "utf8");
  const updateRoute = readFileSync("app/api/company/hr/employee-bundle/update/route.ts", "utf8");
  const createMigration = readFileSync("supabase/migrations/20260831203000_hr_core_300_atomic_employee.sql", "utf8");
  const updateMigration = readFileSync("supabase/migrations/20260831204500_hr_core_300_atomic_employee_update.sql", "utf8");
  const intelligence = readFileSync("lib/hr/document-intelligence.ts", "utf8");

  it("has one direct shell and no legacy workspace monoliths", () => {
    expect(shell).toContain("HrDashboardCore300");
    expect(shell).toContain("HrEmployeeRegistry300");
    expect(shell).toContain("HrComplianceCore300");
    expect(wrapper).toContain("HrWorkspaceCore300");
    expect(shell).not.toContain("HrWorkspace140");
    expect(shell).not.toContain("HrWorkspace148");
    expect(existsSync("components/company/hr/hr-workspace-140.tsx")).toBe(false);
    expect(existsSync("components/company/hr/hr-workspace-148.tsx")).toBe(false);
  });

  it("creates and edits employee bundles through atomic database functions", () => {
    expect(create).toContain("/api/company/hr/employee-bundle");
    expect(registry).toContain("/api/company/hr/employee-bundle/update");
    expect(createRoute).toContain("create_hr_employee_bundle_atomic");
    expect(updateRoute).toContain("update_hr_employee_bundle_atomic");
    expect(createMigration).toContain("create_hr_employee_bundle_atomic");
    expect(updateMigration).toContain("update_hr_employee_bundle_atomic");
    expect(create).not.toContain("partialCreated");
  });

  it("feeds high-confidence OCR documents into formal HR registers", () => {
    expect(intelligence).toContain("createComplianceFromDocument");
    expect(intelligence).toContain("medical_exams");
    expect(intelligence).toContain("safety_trainings");
    expect(intelligence).toContain("qualifications");
    expect(intelligence).toContain("employeeScore >= 0.93");
    expect(intelligence).toContain("dates.confidence >= 0.9");
    expect(intelligence).toContain("document_id");
  });
});
