import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR calendar unified assignment select 530", () => {
  const editor = read("components/company/hr/hr-timesheet-entry-editor-159.tsx");

  it("offers Urlop in the same select as projects and removes the separate day mode bar", () => {
    expect(editor).toContain('const VACATION_OPTION = "__vacation__"');
    expect(editor).toContain('<option value={VACATION_OPTION}>URLOP</option>');
    expect(editor).toContain("Inwestycja / status");
    expect(editor).toContain('data-unified-vacation-select="1"');
    expect(editor).not.toContain("styles.dayModeBar");
    expect(editor).not.toContain("Przywróć pracę");
  });

  it("keeps vacation automation behind the unified select", () => {
    expect(editor).toContain('fetch("/api/company/hr/calendar-leave"');
    expect(editor).toContain('action: nextVacation ? "set" : "clear"');
    expect(editor).toContain("await setCalendarVacation(true)");
    expect(editor).toContain("await setCalendarVacation(false, true)");
    expect(editor).toContain("clearDayMarkers");
  });
});
