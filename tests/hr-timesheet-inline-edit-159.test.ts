import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry 1.5.9 editable daily timesheets", () => {
  const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const calendar = readFileSync("components/company/hr/hr-dashboard-calendar-159.tsx", "utf8");
  const calendarCss = readFileSync("components/company/hr/hr-dashboard-calendar-147.module.css", "utf8");
  const records = readFileSync("components/company/hr/hr-time-records-159.tsx", "utf8");
  const editor = readFileSync("components/company/hr/hr-timesheet-entry-editor-159.tsx", "utf8");
  const editorCss = readFileSync("components/company/hr/hr-timesheet-entry-editor-159.module.css", "utf8");
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

  it("keeps the selected-day roster dense and scrollable for larger teams", () => {
    expect(calendar).toContain("styles.employeeLink");
    expect(calendar).toContain("onOpenEmployeeCalendar");
    expect(calendar).toContain("styles.inlineEditorCell");
    expect(calendarCss).toContain("max-height:min(52vh,480px)");
    expect(calendarCss).toContain("position:sticky;top:0");
    expect(calendarCss).toContain(".employeeLink");
    expect(editor).toContain("styles.inlineCompact");
    expect(editor).toContain("styles.addInline");
    expect(editorCss).toContain(".inlineCompact .entryRow");
    expect(editorCss).toContain("height:30px");
  });

  it("opens a focused monthly work calendar from the employee name", () => {
    expect(wrapper).toContain("timeFocus");
    expect(wrapper).toContain("openEmployeeWorkCalendar");
    expect(wrapper).toContain("initialEmployeeId={timeFocus?.employeeId ?? null}");
    expect(calendar).toContain("onOpenEmployeeCalendar?.(employeeId, selectedDate)");
    expect(records).toContain("Kalendarz pracy pracownika");
    expect(records).toContain("Kalendarz pracy —");
    expect(records).toContain("visibleEmployees");
    expect(records).toContain("Wszyscy pracownicy");
    expect(records).toContain('initialEmployee ? "month" : "day"');
  });

  it("replaces the legacy records matrix with a simple editable day/month employee grid", () => {
    expect(records).toContain('type Period = "day" | "month"');
    expect(records).toContain('variant="cell"');
    expect(records).toContain("data-hr-editable-time-records");
    expect(wrapper).toContain('hiddenTabs={["employees", "time", "documents"]}');
    expect(records).not.toContain("MutationObserver");
    expect(records).toContain("createPortal");
    expect(records).toContain("prosty spis pracowników — wybierz inwestycję, wpisz godziny, a szczegóły rozwiń przy konkretnej osobie");
    expect(records).toContain("Szczegóły robocizny");
    expect(records).toContain('data-hr-employee-detail-row="1"');
    expect(records).toContain('data-hr-month-detail-editor="1"');
    expect(records).toContain("Pełna ewidencja dnia");
    expect(records).toContain(">Dzień</button>");
    expect(records).toContain(">Miesiąc</button>");
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
