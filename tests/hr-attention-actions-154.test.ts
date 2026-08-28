import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry 1.5.4 attention actions", () => {
  const workspace = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const css = readFileSync("components/company/hr/hr-workspace-146.module.css", "utf8");

  it("turns every dashboard alert into a keyboard-accessible action", () => {
    expect(workspace).toContain('section[class*="grid2"] [class*="alertList"] [class*="alert"]');
    expect(workspace).toContain('element.dataset.hrActionIndex = String(index)');
    expect(workspace).toContain('element.setAttribute("role", "button")');
    expect(workspace).toContain('element.setAttribute("tabindex", "0")');
  });

  it("routes time and leave decisions directly to their handling sections", () => {
    expect(workspace).toContain('activateTab("time", () => scrollToHeading("Do zatwierdzenia"))');
    expect(workspace).toContain('activateTab("leaves", () => scrollToHeading("Wnioski do decyzji"))');
    expect(workspace).toContain('activateTab("compliance", () => scrollToHeading("Uprawnienia, badania i BHP"))');
  });

  it("shows a clear action affordance on each attention item", () => {
    expect(css).toContain('content:"Otwórz →"');
    expect(css).toContain('cursor:pointer');
    expect(css).toContain('[data-hr-action-index]:focus-visible');
  });
});
