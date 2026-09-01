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
      exams: [{ employee_id: "e1", examined_at: "2026-01-01", valid_until: "2027-01-01", status: "valid" }],
      trainings: [{ employee_id: "e1", completed_at: "2026-01-01", valid_until: "2027-01-01", status: "valid" }]
    }), { canViewPayroll: true });
    expect(result.issues.some((row) => row.kind === "allocation")).toBe(true);
    expect(result.issues.some((row) => row.kind === "timesheet")).toBe(true);
    expect(result.issues.filter((row) => row.kind === "leave").length).toBeGreaterThanOrEqual(2);
  });

  it("treats an unfit medical result as critical even when its date is still current", () => {
    const result = buildHrEmployeeIssues(data({
      employments: [{ id: "em1", employee_id: "e1", valid_from: "2026-01-01", monthly_cost: 9000, hourly_cost: 60 }],
      exams: [{ employee_id: "e1", examined_at: "2026-08-01", valid_until: "2027-08-31", status: "unfit" }],
      trainings: [{ employee_id: "e1", completed_at: "2026-01-01", valid_until: "2027-08-31", status: "valid" }],
      leaveBalances: [{ employee_id: "e1", entitlement_configured: true, remaining_days: 20 }]
    }));
    expect(result.issues.some((row) => row.kind === "medical" && row.severity === "critical" && row.title.includes("niezdolny"))).toBe(true);
  });

  it("uses the newest medical event instead of an older record with a later expiry", () => {
    const result = buildHrEmployeeIssues(data({
      employments: [{ id: "em1", employee_id: "e1", valid_from: "2026-01-01", monthly_cost: 9000, hourly_cost: 60 }],
      exams: [
        { id: "old", employee_id: "e1", examined_at: "2025-12-01", valid_until: "2027-12-31", status: "valid" },
        { id: "new", employee_id: "e1", examined_at: "2026-08-20", valid_until: "2026-09-05", status: "unfit" }
      ],
      trainings: [{ employee_id: "e1", completed_at: "2026-01-01", valid_until: "2027-08-31", status: "valid" }],
      leaveBalances: [{ employee_id: "e1", entitlement_configured: true, remaining_days: 20 }]
    }));
    expect(result.issues.some((row) => row.kind === "medical" && row.title.includes("niezdolny"))).toBe(true);
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
  const time400 = readFileSync("components/company/hr/hr-time-records-400.tsx", "utf8");
  const timeRange = readFileSync("app/api/company/hr/timesheet-range/route.ts", "utf8");
  const timeBulk = readFileSync("app/api/company/hr/timesheet-bulk/route.ts", "utf8");
  const packageJson = readFileSync("package.json", "utf8");

  it("has one direct shell and no legacy workspace monoliths", () => {
    expect(shell).toContain("HrDashboardCore300"); expect(shell).toContain("HrEmployeeRegistry300"); expect(shell).toContain("HrComplianceCore300"); expect(wrapper).toContain("HrWorkspaceCore300"); expect(shell).not.toContain("HrWorkspace140"); expect(shell).not.toContain("HrWorkspace148");
    expect(existsSync("components/company/hr/hr-workspace-140.tsx")).toBe(false); expect(existsSync("components/company/hr/hr-workspace-148.tsx")).toBe(false); expect(existsSync("components/company/hr/hr-workspace-146.tsx")).toBe(false); expect(existsSync("components/company/hr/hr-workspace-147.tsx")).toBe(false);
  });

  it("lazy-loads heavy HR sections and keeps the annual lifecycle test in the build gate", () => {
    expect(shell).toContain('import dynamic from "next/dynamic"'); expect(shell).toContain("dynamic(() => import(\"./hr-employee-registry-300\")"); expect(shell).toContain("dynamic(() => import(\"./hr-time-records-400\")"); expect(shell).toContain("dynamic(() => import(\"./hr-documents-compact-161\")"); expect(packageJson).toContain("tests/hr-year-lifecycle-10-workers.test.ts");
  });

  it("creates and edits employee bundles through atomic database functions", () => {
    expect(create).toContain("/api/company/hr/employee-bundle"); expect(registry).toContain("/api/company/hr/employee-bundle/update"); expect(createRoute).toContain("create_hr_employee_bundle_atomic"); expect(updateRoute).toContain("update_hr_employee_bundle_atomic"); expect(createMigration).toContain("create_hr_employee_bundle_atomic"); expect(updateMigration).toContain("update_hr_employee_bundle_atomic"); expect(create).not.toContain("partialCreated");
  });

  it("feeds only high-confidence OCR documents into formal HR registers", () => {
    expect(intelligence).toContain("createComplianceFromDocument"); expect(intelligence).toContain("medical_exams"); expect(intelligence).toContain("safety_trainings"); expect(intelligence).toContain("qualifications");
    expect(intelligence).toMatch(/employeeScore\s*>=\s*0\.93/); expect(intelligence).toMatch(/dates\.confidence\s*>=\s*0\.9/); expect(intelligence).toContain("document_id");
  });

  it("keeps templates out of HR employee routing and rejects short employee numbers as strong identifiers", () => {
    expect(intelligence).toMatch(/document\.category\s*===\s*["']template["']/);
    expect(intelligence).toMatch(/employeeNumber\.length\s*>=\s*3/);
  });

  it("keeps HR Time 4.0 day, week, month and history workflows", () => {
    expect(time400).toContain('type ViewMode = "day" | "week" | "month" | "history"'); expect(time400).toContain("−7 dni"); expect(time400).toContain("−30 dni"); expect(time400).toContain("Główny ekran korekt"); expect(time400).toContain("Kalendarz całej ekipy"); expect(time400).toContain("Wyszukaj i popraw dowolny wpis"); expect(time400).toContain("Plan ≠ wykonanie");
  });

  it("loads history by date range and exposes safe bulk editing", () => {
    expect(time400).toContain("/api/company/hr/timesheet-range"); expect(time400).toContain("/api/company/hr/timesheet-bulk"); expect(time400).toContain('params.set("offset"'); expect(timeRange).toContain('.gte("work_date", from)'); expect(timeRange).toContain('.lte("work_date", to)'); expect(timeBulk).toContain("isPolishWorkingDay"); expect(timeBulk).toContain('mode === "replace_single"'); expect(timeBulk).toContain("skippedLeave"); expect(timeBulk).toContain("skippedConflict");
  });
});
