import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry 1.5.9 editable daily timesheets", () => {
  const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const calendar = readFileSync("components/company/hr/hr-dashboard-calendar-159.tsx", "utf8");
  const records = readFileSync("components/company/hr/hr-time-records-159.tsx", "utf8");
  const editor = readFileSync("components/company/hr/hr-timesheet-entry-editor-159.tsx", "utf8");
  const api = readFileSync("app/api/company/hr/timesheet-entry/route.ts", "utf8");

  it("uses editable calendar and editable time records in the HR shell", () => {
    expect(wrapper).toContain("HrDashboardCalendar159");
    expect(wrapper).toContain("HrTimeRecords159");
    expect(wrapper).toContain('const timeVisible = activeTab === "time"');
  });

  it("offers direct investment and hour editing under the selected calendar day", () => {
    expect(calendar).toContain('variant="inline"');
    expect(calendar).toContain("suggestedProjectId");
    expect(calendar).toContain("Inwestycja / edycja");
    expect(calendar).toContain("data-hr-editable-calendar");
  });

  it("replaces the legacy records matrix with an editable day-cell grid", () => {
    expect(records).toContain('variant="cell"');
    expect(records).toContain("data-hr-editable-time-records");
    expect(records).toContain('panel.style.display = "none"');
    expect(records).toContain("kliknij dowolny dzień, aby edytować inwestycję i godziny");
  });

  it("updates existing records instead of creating duplicates and can remove bad entries", () => {
    expect(editor).toContain('entry?.id ? "update" : "create"');
    expect(editor).toContain('fetch("/api/company/hr/timesheet-entry"');
    expect(api).toContain('type Action = "create" | "update" | "delete"');
    expect(api).toContain('db.from("timesheets").update(patch)');
    expect(api).toContain('db.from("timesheets").delete()');
    expect(api).toContain('status: "submitted"');
    expect(api).toContain("approved_by: null");
  });
});
