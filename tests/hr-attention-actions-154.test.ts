import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry 1.5.4 attention actions", () => {
  const workspace = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const css = readFileSync("components/company/hr/hr-workspace-146.module.css", "utf8");

  it("targets only the outer dashboard alert as a keyboard-accessible action", () => {
    expect(workspace).toContain('section[class*="grid2"] [class*="alertList"] > article[class*="alert"]');
    expect(workspace).not.toContain('section[class*="grid2"] [class*="alertList"] [class*="alert"]');
    expect(workspace).toContain('element.dataset.hrActionIndex = String(index)');
    expect(workspace).toContain('element.setAttribute("role", "button")');
    expect(workspace).toContain('element.setAttribute("tabindex", "0")');
  });

  it("restores the action affordance whenever dashboard alert DOM is remounted", () => {
    expect(workspace).toContain("const syncAttentionActions = () =>");
    expect(workspace).toContain("const observer = new MutationObserver(() => syncDashboardEnhancements())");
    expect(workspace).toContain("observer.observe(root, { childList: true, subtree: true })");
    expect(workspace).toContain("return () => observer.disconnect()");
  });

  it("routes time and leave decisions directly to their handling sections", () => {
    expect(workspace).toContain('activateTab("time", () => scrollToHeading("Do zatwierdzenia"))');
    expect(workspace).toContain('activateTab("leaves", () => scrollToHeading("Wnioski do decyzji"))');
    expect(workspace).toContain('activateTab("compliance", () => scrollToHeading("Uprawnienia, badania i BHP"))');
  });

  it("renders exactly one subtle affordance from the action data hook", () => {
    expect(css).toContain('[data-hr-action-index]::after{content:"Otwórz →"');
    expect(css).not.toContain('[class*="alertList"] [class*="alert"]::after');
    expect(css).toContain('background:#fff;color:#6b7280');
    expect(css).toContain('box-shadow:none');
    expect(css).toContain('[data-hr-action-index]:focus-visible');
  });
});
