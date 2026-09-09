import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("HR time/day-status consistency 5.3", () => {
  it("propagates Urlop and Chorobowe through day, week, month and full detail views", () => {
    const time = source("components/company/hr/hr-time-records-400.tsx");
    expect(time).toContain("/api/company/hr/day-status?");
    expect(time).toContain("leave={detailLeave}");
    expect(time).toContain('dayStatus={detailSick ? "sick" : null}');
    expect(time).toContain("enableDayStatusSelection");
    expect(time).toContain("enableSickStatus");
    expect(time).toContain("monthVacation");
    expect(time).toContain("monthSick");
    expect(time).toContain("data-hr-time-day-status-sync");
  });

  it("offers URLOP and CHOROBOWE in the full historical correction selector", () => {
    const work = source("components/company/hr/hr-work-cost-160.tsx");
    expect(work).toContain('<option value={VACATION_OPTION}>URLOP</option>');
    expect(work).toContain('<option value={SICK_OPTION}>CHOROBOWE</option>');
    expect(work).toContain('postDayStatus("/api/company/hr/calendar-leave"');
    expect(work).toContain('postDayStatus("/api/company/hr/day-status"');
    expect(work).toContain("data-hr-day-status-synced");
    expect(work).toContain("Urlop zapisany. Wniosek urlopowy jest zsynchronizowany");
    expect(work).toContain("Chorobowe zapisane jako niezależny znacznik dnia");
  });

  it("prevents direct time writes while an approved leave or sick marker is active", () => {
    const route = source("app/api/company/hr/timesheet-entry/route.ts");
    expect(route).toContain("ensureWorkDayAvailable");
    expect(route).toMatch(/from\("leave_requests"\)[\s\S]*?\.eq\("status", "approved"\)/);
    expect(route).toMatch(/from\("hr_day_statuses"\)[\s\S]*?\.eq\("status", "sick"\)/);
    expect(route).toContain("Najpierw zmień status dnia, a dopiero potem zapisz pracę");
    expect(route).toMatch(/if \(body\.action === "create"\)[\s\S]*?ensureWorkDayAvailable/);
    expect(route).toMatch(/select\("employee_id,work_date"\)[\s\S]*?ensureWorkDayAvailable/);
  });

  it("keeps bulk time editing from overwriting Chorobowe", () => {
    const route = source("app/api/company/hr/timesheet-bulk/route.ts");
    const migration = source("supabase/migrations/20260909121500_hr_time_day_status_consistency_530.sql");
    expect(route).toContain("skippedSick");
    expect(migration).toContain("v_skipped_sick integer := 0");
    expect(migration).toContain("from public.hr_day_statuses d");
    expect(migration).toContain("and d.status = 'sick'");
    expect(migration).toContain("'skippedSick', v_skipped_sick");
  });

  it("keeps distinct visual statuses for Urlop, Chorobowe and data conflicts", () => {
    const css = source("components/company/hr/hr-time-records-400.module.css");
    const workCss = source("components/company/hr/hr-work-cost-160.module.css");
    expect(css).toContain(".vacationChip");
    expect(css).toContain(".sickChip");
    expect(css).toContain(".monthVacation");
    expect(css).toContain(".monthSick");
    expect(css).toContain(".monthConflict");
    expect(workCss).toContain(".dayStatusVacation");
    expect(workCss).toContain(".dayStatusSick");
  });
});
