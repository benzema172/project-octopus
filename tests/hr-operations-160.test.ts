import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry Core 3.0 — dokumenty, czas i księgowość", () => {
  const migration = readFileSync("supabase/migrations/20260830094000_hr_time_cost_accounting_bridge.sql", "utf8");
  const hybridSnapshotMigration = readFileSync("supabase/migrations/20260831060000_hr_timesheet_snapshot_hybrid_rate.sql", "utf8");
  const timesheetApi = readFileSync("app/api/company/hr/timesheet-entry/route.ts", "utf8");
  const laborApi = readFileSync("app/api/company/hr/labor-control/route.ts", "utf8");
  const laborUi = readFileSync("components/company/hr/hr-work-cost-160.tsx", "utf8");
  const timeRecordsUi = readFileSync("components/company/hr/hr-time-records-400.tsx", "utf8");
  const formalUi = readFileSync("components/company/hr/hr-formal-documents-162.tsx", "utf8");
  const accountingApi = readFileSync("app/api/company/hr/accounting-bridge/route.ts", "utf8");
  const accountingUi = readFileSync("components/company/hr/hr-accounting-bridge-160.tsx", "utf8");
  const documentsUi = readFileSync("components/company/hr/hr-documents-compact-161.tsx", "utf8");
  const workspace = readFileSync("components/company/hr/hr-workspace-core-300.tsx", "utf8");

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
    for (const token of ["work_type", "cost_code", "work_scope", "started_at", "ended_at", "break_minutes", "quantity", "unit"]) expect(migration).toContain(token);
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
    expect(formalUi).toContain("employeeDocuments");
    expect(formalUi).toContain("exams");
    expect(formalUi).toContain("trainings");
    expect(formalUi).toContain("qualifications");
    expect(documentsUi).toContain("Wzory i Brain");
    expect(documentsUi).toContain("HrFormalDocuments162");
  });

  it("prepares a validated universal accounting CSV bridge", () => {
    expect(accountingApi).toContain("CZAS_DO_ZATWIERDZENIA");
    expect(accountingApi).toContain("BRAK_ZAMKNIECIA_PLAC");
    expect(accountingApi).toContain("BRAK_SNAPSHOT_KOSZTU");
    expect(accountingApi).toContain("text/csv; charset=utf-8");
    expect(accountingApi).toContain("octopus-most-ksiegowy");
    expect(accountingUi).toContain("Most księgowy v1");
    expect(accountingUi).toContain("Eksport CSV");
  });

  it("mounts current time, formal-document and accounting capabilities in Core 3.0", () => {
    expect(timeRecordsUi).toContain("HrWorkCost160");
    expect(timeRecordsUi).toContain("fixedEmployeeId={detailFocus.employeeId}");
    expect(timeRecordsUi).toContain("fixedWorkDate={detailFocus.workDate}");
    expect(workspace).toContain("HrTimeRecords400");
    expect(workspace).toContain("HrDocumentsCompact161");
    expect(documentsUi).toContain("HrAccountingBridge160");
  });
});
