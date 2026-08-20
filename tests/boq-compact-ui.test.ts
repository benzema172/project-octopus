import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = () => readFileSync("app/workspace/projects/[projectId]/cost-estimate/page.tsx", "utf8");

describe("compact BOQ workspace", () => {
  it("does not use the descriptive module foundation", () => {
    const content = page();
    expect(content).not.toContain("ProjectModuleFoundation");
    expect(content).not.toContain("workflow={");
    expect(content).not.toContain("items={[");
    expect(content).not.toContain("principle=");
  });

  it("keeps the actual BOQ visible and auxiliary tools collapsed", () => {
    const content = page();
    expect(content).toContain("pw-boq-table");
    expect(content).toContain("boqItems.map");
    expect(content).toContain("Importy i analiza kosztorysu");
    expect(content).toContain("Źródła kosztorysu");
    expect(content).toContain("Zmiana zakresu / kontraktu");
    expect(content).toContain("<details");
  });
});
