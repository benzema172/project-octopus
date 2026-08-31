import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR time tab advanced labor controls", () => {
  it("keeps the everyday employee time list visible and hides detailed labor controls by default", () => {
    const workspace = read("components/company/hr/hr-workspace-147.tsx");

    expect(workspace).toContain("<HrTimeRecords159");
    expect(workspace).toContain("<details className={styles.advancedTimeDetails}");
    expect(workspace).toContain("Szczegóły robocizny, WBS i kosztów");
    expect(workspace).toContain("<HrWorkCost160");
    expect(workspace.indexOf("<HrTimeRecords159")).toBeLessThan(workspace.indexOf("<details className={styles.advancedTimeDetails}"));
  });

  it("styles the advanced section as a compact expandable control", () => {
    const css = read("components/company/hr/hr-workspace-146.module.css");

    expect(css).toContain(".advancedTimeDetails{");
    expect(css).toContain(".advancedTimeSummary{");
    expect(css).toContain(".advancedTimeOpen{display:none}");
    expect(css).toContain(".advancedTimeDetails[open] .advancedTimeOpen{display:inline}");
    expect(css).toContain(".advancedTimeBody>section{margin-top:0!important;border:0!important");
  });
});
