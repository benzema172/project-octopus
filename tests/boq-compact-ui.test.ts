import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = () => readFileSync("app/workspace/projects/[projectId]/cost-estimate/page.tsx", "utf8");
const workspace = () => readFileSync("components/projects/boq-change-control-workspace.tsx", "utf8");

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
    const editor = workspace();
    expect(content).toContain("BoqChangeControlWorkspace");
    expect(editor).toContain("boq-control-table");
    expect(editor).toContain("visibleItems.map");
    expect(content).toContain("Importy i analiza kosztorysu");
    expect(content).toContain("Źródła kosztorysu");
    expect(editor).toContain("Rejestr Change Order");
    expect(content).toContain("<details");
  });
});
