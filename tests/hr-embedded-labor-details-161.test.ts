import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/company/hr/hr-work-cost-160.tsx", "utf8");
const css = readFileSync("components/company/hr/hr-work-cost-160.module.css", "utf8");

describe("HR employee-linked detailed labor view", () => {
  it("does not repeat a single employee/day record below the detailed form", () => {
    expect(source).toContain("embedded ? rows.length > 1 ?");
    expect(source).toContain('data-hr-day-split="1"');
    expect(source).toContain("Lista pojawia się tylko wtedy, gdy dzień faktycznie został rozbity na kilka zakresów.");
    expect(source).not.toContain("Brak wpisu szczegółowego dla tego pracownika i dnia. Formularz powyżej utworzy pierwszy.");
  });

  it("keeps employee and date as context instead of duplicate read-only form fields", () => {
    expect(source).toContain('fixedEmployeeId ? <input type="hidden" name="employeeId"');
    expect(source).toContain('fixedWorkDate ? <input type="hidden" name="workDate"');
    expect(source).toContain("Szczegóły robocizny");
    expect(source).toContain("contextProject");
    expect(source).toContain("contextStatus");
  });

  it("uses a clear additional-scope action and a compact split-day list only when needed", () => {
    expect(source).toContain("+ Dodaj kolejny zakres");
    expect(source).toContain("Podział dnia · {rows.length} wpisy");
    expect(css).toContain(".splitBlock{");
    expect(css).toContain(".splitRow{");
    expect(css).toContain(".embedded .field textarea");
  });
});
