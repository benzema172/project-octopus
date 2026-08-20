import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/workspace/projects/[projectId]/schedule/page.tsx", "utf8");
const css = readFileSync("app/schedule-compact.css", "utf8");

describe("compact investment schedule", () => {
  it("removes the generic descriptive module foundation from the schedule page", () => {
    expect(page).not.toContain("ProjectModuleFoundation");
    expect(page).not.toContain("Tryb pracy");
    expect(page).not.toContain("Przepływ pracy");
    expect(page).not.toContain("Jak pracuje ten moduł");
    expect(page).not.toContain("Ryzyka i opóźnienia");
  });

  it("keeps only the schedule header, live records and collapsed working tools", () => {
    expect(page).toContain("Harmonogram inwestycji");
    expect(page).toContain('className="pw-schedule-tool"');
    expect(page).toContain("Dodaj zadanie harmonogramu");
    expect(page).toContain('<ProjectLiveRecords projectId={projectId} kind="schedule" />');
    expect(page).toContain('className="pw-schedule-sources"');
  });

  it("uses the global 10px vertical rhythm and keeps the operation form visually nested", () => {
    expect(css).toContain(".pw-schedule-compact {");
    expect(css).toContain("gap: 10px");
    expect(css).toContain(".pw-schedule-tool .project-operation-card");
    expect(css).toContain("border: 0 !important");
  });
});
