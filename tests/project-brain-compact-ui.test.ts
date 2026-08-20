import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("project Brain compact workspace", () => {
  it("keeps provider/runtime diagnostics out of the full project Brain workspace", () => {
    const panel = read("components/brain/brain-panel.tsx");
    const workspacePart = panel.split("if (compact)")[1]?.split("const totalKnowledge")[1] ?? "";
    expect(workspacePart).not.toContain("Dostawca AI");
    expect(workspacePart).not.toContain("Gemini");
    expect(workspacePart).not.toContain("Pipeline aktywny");
  });

  it("focuses the workspace on knowledge and human verification", () => {
    const panel = read("components/brain/brain-panel.tsx");
    expect(panel).toContain("Jedna pamięć inwestycji zasilana dokumentacją");
    expect(panel).toContain("Ostatnio rozpoznane");
    expect(panel).toContain("Do weryfikacji");
    expect(panel).toContain("brain-knowledge-inline");
  });

  it("uses one compact two-column content area instead of metric cards", () => {
    const css = read("app/brain-knowledge.css");
    expect(css).toContain(".brain-workspace__content");
    expect(css).toContain("grid-template-columns: minmax(0,1.8fr) minmax(280px,.8fr)");
    expect(css).not.toContain(".brain-knowledge-grid");
  });
});
