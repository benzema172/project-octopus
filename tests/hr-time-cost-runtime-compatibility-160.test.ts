import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const laborControl = readFileSync("app/api/company/hr/labor-control/route.ts", "utf8");
const timesheetEntry = readFileSync("app/api/company/hr/timesheet-entry/route.ts", "utf8");
const runtimeMigration = readFileSync("supabase/migrations/20260831090000_hr_timesheet_runtime_compatibility.sql", "utf8");
const autoFinalMigration = readFileSync("supabase/migrations/20260901121400_hr_timesheets_auto_final_430.sql", "utf8");

describe("Kadry runtime schema compatibility", () => {
  it("uses the canonical WBS status schema instead of removed projection columns", () => {
    expect(laborControl).toContain('.select("id,project_id,parent_id,code,name,branch,installation,zone,sort_order,status")');
    expect(laborControl).toContain('.eq("status", "active")');
    expect(laborControl).not.toContain('level,path,is_active');
    expect(laborControl).not.toContain('.eq("is_active", true)');
  });

  it("keeps timesheet notes and automatic finalization backed by production migrations", () => {
    expect(timesheetEntry).toContain('note: text(payload.note');
    expect(timesheetEntry).toContain('approved_at: finalizedAt');
    expect(timesheetEntry).toContain('status: "approved"');
    expect(runtimeMigration).toContain("add column if not exists note text");
    expect(runtimeMigration).toContain("add column if not exists approved_at timestamptz");
    expect(autoFinalMigration).toContain("status = 'approved'");
    expect(autoFinalMigration).toContain("approved_at = v_finalized_at");
  });

  it("keeps labor-control timesheet selection compatible with the new fields", () => {
    expect(laborControl).toContain("source,note,work_type,cost_code,work_scope");
  });
});
