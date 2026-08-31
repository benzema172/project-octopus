import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry 1.6.0 — dokumenty, czas i księgowość", () => {
  const migration = readFileSync("supabase/migrations/20260830094000_hr_time_cost_accounting_bridge.sql", "utf8");
  const hybridSnapshotMigration = readFileSync("supabase/migrations/20260831060000_hr_timesheet_snapshot_hybrid_rate.sql", "utf8");
  const timesheetApi = readFileSync("app/api/company/hr/timesheet-entry/route.ts", "utf8");
  const laborApi = readFileSync("app/api/company/hr/labor-control/route.ts", "utf8");
  const laborUi = readFileSync("components/company/hr/hr-work-cost-160.tsx", "utf8");
  const formalUi = readFileSync("components/company/hr/hr-formal-documents-160.tsx", "utf8");
  const accountingApi = readFileSync("app/api/company/hr/accounting-bridge/route.ts", "utf8");
  const accountingUi = readFileSync("components/company/hr/hr-accounting-bridge-160.tsx", "utf8");
  const workspace = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");

  it("freezes historical labor cost and reuses investment WBS", () => {
    expect(migration).toContain("hourly_cost_snapshot");
    expect(migration).toContain("labor_cost_snapshot");
    expect(migration).toContain("hr_snapshot_timesheet_labor_cost");
    expect(migration).toContain("wbs_node_id");
    expect(migration).toContain("Sama akceptacja wpisu nie może przepisać historii nową stawką");
    expect(hybridSnapshotMigration).toContain("operational_net_hourly_rate");
    expect(hybridSnapshotMigration).toContain("hourly_with_monthly_base");
    expect(timesheetApi).toContain('db.from("wbs_nodes")');
    expect(timesheetApi).toContain("wbs_node_id: wbsNodeId");
  });

  it("records construction context, work types, clock times and quantities", () => {
    for (const token of ["work_type", "cost_code", "work_scope", "started_at", "ended_at", "break_minutes", "quantity", "unit"]) {
      expect(migration).toContain(token);
    }
    expect(timesheetApi).toContain("calculatedClockHours");
    expect(timesheetApi).toContain('"travel"');
    expect(timesheetApi).toContain('"downtime"');
    expect(laborUi).toContain("WBS / zakres kosztorysowy");
    expect(laborUi).toContain("Zakres wykonanych prac");
    expect(laborUi).toContain("Przerwa min");
    expect(laborUi).toContain("Kod kosztowy");
  });

  it("does not expose frozen costs without payroll/finance access", () => {
    expect(laborApi).toContain("canViewCosts");
    expect(laborApi).toContain("hourly_cost_snapshot: null");
    expect(laborApi).toContain("labor_cost_snapshot: null");
    expect(laborUi).toContain("data?.canViewCosts");
  });

  it("builds formal completeness from canonical HR records instead of copies", () => {
    expect(formalUi).toContain("data.employeeDocuments");
    expect(formalUi).toContain("data.exams");
    expect(formalUi).toContain("data.trainings");
    expect(formalUi).toContain("data.qualifications");
    expect(formalUi).toContain("Wzory i Brain");
    expect(formalUi).toContain("Nie tworzymy kopii danych");
  });

  it("prepares a validated universal accounting CSV bridge", () => {
    expect(accountingApi).toContain("CZAS_DO_ZATWIERDZENIA");
    expect(accountingApi).toContain("BRAK_ZAMKNIECIA_PLAC");
    expect(accountingApi).toContain("BRAK_SNAPSHOT_KOSZTU");
    expect(accountingApi).toContain("NextResponse.json");
    expect(accountingApi).toContain("text/csv; charset=utf-8");
    expect(accountingApi).toContain("octopus-most-ksiegowy");
    expect(accountingApi).not.toContain("is_primary");
    expect(accountingUi).toContain("Most księgowy v1");
    expect(accountingUi).toContain("Eksport CSV");
  });

  it("mounts all three new HR capabilities in their existing tabs", () => {
    expect(workspace).toContain("HrWorkCost160");
    expect(workspace).toContain("HrFormalDocuments160");
    expect(workspace).toContain("HrAccountingBridge160");
    expect(workspace).toContain('section[class*="grid2"] [class*="alertList"] > article[class*="alert"]');
  });
});
