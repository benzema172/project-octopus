import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const laborControl = readFileSync("app/api/company/hr/labor-control/route.ts", "utf8");
const timesheetEntry = readFileSync("app/api/company/hr/timesheet-entry/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260831090000_hr_timesheet_runtime_compatibility.sql", "utf8");

describe("Kadry 1.6 runtime schema compatibility", () => {
  it("uses the canonical WBS status schema instead of removed projection columns", () => {
    expect(laborControl).toContain('.select("id,project_id,parent_id,code,name,branch,installation,zone,sort_order,status")');
    expect(laborControl).toContain('.eq("status", "active")');
    expect(laborControl).not.toContain('level,path,is_active');
    expect(laborControl).not.toContain('.eq("is_active", true)');
  });

  it("keeps timesheet notes and approval timestamps backed by a production migration", () => {
    expect(timesheetEntry).toContain('note: text(payload.note');
    expect(timesheetEntry).toContain('approved_at: null');
    expect(migration).toContain("add column if not exists note text");
    expect(migration).toContain("add column if not exists approved_at timestamptz");
  });

  it("keeps labor-control timesheet selection compatible with the new fields", () => {
    expect(laborControl).toContain("source,note,work_type,cost_code,work_scope");
  });
});
