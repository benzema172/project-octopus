import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260827090000_hr_2_140.sql", "utf8");
const page = readFileSync("app/workspace/companies/[workspaceId]/hr/page.tsx", "utf8");
const ui = readFileSync("components/company/hr/hr-workspace-140.tsx", "utf8");
const css141 = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-employee-list-141.module.css", "utf8");
const api = readFileSync("app/api/company/hr/route.ts", "utf8");
const loader = readFileSync("lib/data/hr-workspace-140.ts", "utf8");
const exportRoute = readFileSync("app/api/company/hr/export/route.ts", "utf8");
const workCalendar = readFileSync("lib/hr/polish-work-calendar.ts", "utf8");

describe("Project Octopus 1.4.0 — Kadry 2.0", () => {
  it("adds the missing HR domain model without replacing existing employee data", () => {
    for (const table of ["hr_teams", "hr_team_members", "safety_trainings", "employee_documents", "leave_entitlements"]) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toContain("alter table public.timesheets add column if not exists team_id");
    expect(migration).toContain("alter table public.assignments add column if not exists source_team_id");
    expect(migration).toContain("with (security_invoker = true)");
  });

  it("uses a dedicated Kadry workspace with seven operational tabs", () => {
    expect(page).toContain("HrWorkspace140");
    expect(page).toContain("getHrWorkspace140Data");
    for (const label of ["Pulpit", "Pracownicy", "Czas pracy", "Urlopy i absencje", "Uprawnienia i BHP", "Zespoły i inwestycje", "Dokumenty"]) {
      expect(ui).toContain(label);
    }
  });

  it("supports employee cards, teams, compliance, assets and project labor cost", () => {
    for (const marker of ["Karta pracownika", "timesheet_bulk_team", "team_assign_project", "safety_training_create", "issued_asset_create", "Pełny koszt zatrudnienia", "Zdolność do pracy"]) {
      expect(ui).toContain(marker);
    }
    expect(loader).toContain("approvedLaborCost");
    expect(loader).toContain("projectStaff");
    expect(loader).toContain("missingYesterday");
  });

  it("calculates Polish working leave days instead of trusting a manually typed count", () => {
    expect(api).toContain('import { countPolishWorkingDays } from "@/lib/hr/polish-work-calendar"');
    expect(api).toContain("const days = countPolishWorkingDays(from, to)");
    expect(workCalendar).toContain('fixed.push(`${year}-12-24`)');
    expect(workCalendar).toContain("addDays(easter, 1)");
    expect(workCalendar).toContain("addDays(easter, 60)");
    expect(ui).not.toContain('name="days"');
  });

  it("uses existing document AI output for controlled employee-document suggestions", () => {
    expect(api).toContain("employee_document_autolink");
    expect(api).toContain("document_extractions");
    expect(api).toContain("AI potrzebuje decyzji");
    expect(api).toContain('source: "ai_suggestion"');
    expect(ui).toContain("Rozpoznaj i przypisz");
    expect(ui).toContain("Otwórz Wrzutnię");
  });

  it("exports a user-readable HR report", () => {
    expect(exportRoute).toContain("text/csv; charset=utf-8");
    expect(exportRoute).toContain("Urlop pozostały");
    expect(ui).toContain("Raport CSV");
  });

  it("keeps the employee list readable and numbers filtered rows from one", () => {
    expect(page).toContain("hr-employee-list-141.module.css");
    expect(page).toContain("styles.hr141");
    expect(css141).toContain("counter-reset: employee-row");
    expect(css141).toContain("counter-increment: employee-row");
    expect(css141).toContain('content: "LP."');
    expect(css141).toContain("content: counter(employee-row)");
    expect(css141).toContain("[data-hr-employee-list]");
    expect(ui).toContain("data-hr-employee-list");
  });
});
