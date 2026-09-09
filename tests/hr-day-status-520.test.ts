import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("HR independent sick-day marker 5.2", () => {
  it("stores CHOROBOWE outside leave_requests", () => {
    const route = source("app/api/company/hr/day-status/route.ts");
    expect(route).toContain('const SICK_STATUS = "sick"');
    expect(route).toContain('type Action = "set_sick" | "clear_sick"');
    expect(route).toMatch(/from\("hr_day_statuses"\)[\s\S]*?\.upsert\(/);
    expect(route).toMatch(/from\("leave_requests"\)[\s\S]*?\.select\(/);
    expect(route).not.toMatch(/from\("leave_requests"\)\s*\.(insert|upsert|update|delete)\s*\(/);
    expect(route).toContain('body.action === "clear_sick"');
  });

  it("keeps the sick marker separate from leave entitlement accounting", () => {
    const migration = source("supabase/migrations/20260909113000_hr_day_statuses_sick_520.sql");
    const loader = source("lib/data/hr-workspace-140.ts");
    expect(migration).toContain("create table if not exists public.hr_day_statuses");
    expect(migration).toContain("check (status in ('sick'))");
    expect(migration).toContain("unique (workspace_id, employee_id, work_date)");
    expect(loader).not.toContain("hr_day_statuses");
    expect(loader).toContain('const annualLeaveRows = leaves.filter');
    expect(loader).toContain('["annual", "on_demand"]');
  });

  it("offers CHOROBOWE next to URLOP only in the calendar-enabled day selector", () => {
    const editor = source("components/company/hr/hr-timesheet-entry-editor-159.tsx");
    const calendar = source("components/company/hr/hr-dashboard-calendar-159.tsx");
    expect(editor).toContain('<option value={VACATION_OPTION}>URLOP</option>');
    expect(editor).toContain('<option value={SICK_OPTION}>CHOROBOWE</option>');
    expect(editor).toContain("enableSickStatus = false");
    expect(editor).toContain('fetch("/api/company/hr/day-status"');
    expect(editor).toContain("Nie utworzono wniosku urlopowego i nie zmieniono puli urlopu");
    expect(calendar).toContain("enableSickStatus");
  });

  it("shows CHOROBOWE in monthly attendance, period reports and print output", () => {
    const attendance = source("components/company/hr/hr-attendance-list-500.tsx");
    expect(attendance).toContain('status: "Chorobowe", statusKind: "sick"');
    expect(attendance).toContain("dni chorobowego");
    expect(attendance).toContain("<small>Chorobowe</small>");
    expect(attendance).toContain("<th>Chorobowe</th>");
    expect(attendance).toContain("renderMonthlySheet(printEmployee, true)");
    expect(attendance).toContain("renderPeriodReport(printEmployee");
  });

  it("requires HR permissions and preserves conflict visibility", () => {
    const route = source("app/api/company/hr/day-status/route.ts");
    const calendar = source("components/company/hr/hr-dashboard-calendar-159.tsx");
    expect(route).toContain('domain: "hr", level');
    expect(route).toContain("Ten dzień ma już aktywny urlop lub inną nieobecność");
    expect(calendar).toContain('statusLabel: "Chorobowe + wpis czasu"');
    expect(calendar).toContain('statusLabel: "Chorobowe + urlop / nieobecność"');
  });
});
