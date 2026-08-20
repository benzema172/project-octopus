import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("project primary actions", () => {
  it("routes Finance primary action to the real budget operation anchor", () => {
    const modulePage = read("components/projects/project-module-page.tsx");
    expect(modulePage).toContain('return `${base}/finance#operation-budget`');
  });

  it("gives every operation form a stable mode-specific anchor", () => {
    const operationForm = read("components/projects/project-operation-form.tsx");
    expect(operationForm).toContain('id={`operation-${mode}`}');
    expect(operationForm).toContain("scrollMarginTop: 16");
  });

  it("uses real operation anchors for the other investment primary actions too", () => {
    const modulePage = read("components/projects/project-module-page.tsx");
    for (const anchor of [
      "#operation-requirement",
      "#operation-protocol",
      "#operation-schedule",
      "#operation-progress_period",
      "#operation-assignment",
      "#operation-reservation"
    ]) expect(modulePage).toContain(anchor);
  });
});
