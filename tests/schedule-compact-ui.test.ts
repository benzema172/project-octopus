import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/workspace/projects/[projectId]/schedule/page.tsx", "utf8");
const css = readFileSync("app/schedule-compact.css", "utf8");
const disclosureCss = readFileSync("app/compact-disclosures.css", "utf8");

describe("compact investment schedule", () => {
  it("removes the generic descriptive module foundation from the schedule page", () => {
    expect(page).not.toContain("ProjectModuleFoundation");
    expect(page).not.toContain("Tryb pracy");
    expect(page).not.toContain("Przepływ pracy");
    expect(page).not.toContain("Jak pracuje ten moduł");
    expect(page).not.toContain("Ryzyka i opóźnienia");
  });

  it("keeps only the schedule header, live records and compact working tools", () => {
    expect(page).toContain("Harmonogram inwestycji");
    expect(page).toContain("CompactDisclosureGroup");
    expect(page).toContain("Dodaj zadanie harmonogramu");
    expect(page).toContain('<ProjectLiveRecords projectId={projectId} kind="schedule" />');
    expect(page).toContain("Źródła harmonogramu");
    expect(page).toContain('id: "schedule-add-task"');
  });

  it("uses the global compact disclosure grid and keeps the schedule at the shared rhythm", () => {
    expect(css).toContain(".pw-schedule-compact {");
    expect(css).toContain("gap: 10px");
    expect(disclosureCss).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(disclosureCss).toContain(".compact-disclosure-group--schedule");
  });
});
