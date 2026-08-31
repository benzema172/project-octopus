import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR detailed work entry compact layout", () => {
  it("uses one visual control system for regular, wide and compact fields", () => {
    const css = read("components/company/hr/hr-work-cost-160.module.css");

    expect(css).toContain(".field,.fieldWide,.fieldSmall{display:grid");
    expect(css).toContain(".field span,.fieldWide span,.fieldSmall span");
    expect(css).toContain(".fieldWide input,.fieldWide select,.fieldWide textarea");
    expect(css).toContain(".fieldSmall input,.fieldSmall select,.fieldSmall textarea");
  });

  it("packs the final form rows without desktop whitespace while keeping mobile full width", () => {
    const css = read("components/company/hr/hr-work-cost-160.module.css");
    const source = read("components/company/hr/hr-work-cost-160.tsx");

    expect(css).toContain(".grid>.fieldSmall:nth-child(n+11):nth-child(-n+14){grid-column:span 3}");
    expect(css).toContain(".note{grid-column:span 9");
    expect(css).toContain(".actions{grid-column:span 3");
    expect(css).toContain(".fieldFull,.note,.actions{grid-column:1/-1}");
    expect(source).toContain("Dodaj szczegółowy wpis z budowy");
    expect(source).toContain("/api/company/hr/timesheet-entry");
  });
});
