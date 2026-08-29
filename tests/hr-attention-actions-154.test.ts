import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry attention actions", () => {
  const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const legacyWorkspace = readFileSync("components/company/hr/hr-workspace-140.tsx", "utf8");
  const css = readFileSync("components/company/hr/hr-workspace-146.module.css", "utf8");

  it("targets only the outer dashboard alert as a keyboard-accessible action", () => {
    expect(wrapper).toContain('section[class*="grid2"] [class*="alertList"] > article[class*="alert"]');
    expect(wrapper).not.toContain('section[class*="grid2"] [class*="alertList"] [class*="alert"]');
    expect(wrapper).toContain('element.dataset.hrActionIndex = String(index)');
    expect(wrapper).toContain('element.setAttribute("role", "button")');
    expect(wrapper).toContain('element.setAttribute("tabindex", "0")');
  });

  it("renders action semantics natively so dashboard remounts do not require a MutationObserver", () => {
    expect(legacyWorkspace).toContain("data-hr-action-index={index}");
    expect(legacyWorkspace).toContain('role="button"');
    expect(legacyWorkspace).toContain("tabIndex={0}");
    expect(wrapper).not.toContain("syncAttentionActions");
    expect(wrapper).not.toContain("syncDashboardEnhancements");
    expect(wrapper).not.toContain("observer.observe(root, { childList: true, subtree: true })");
  });

  it("routes time, leave limits and compliance issues directly to their handling sections", () => {
    expect(wrapper).toContain('activateTab("time", () => scrollToHeading("Do zatwierdzenia"))');
    expect(wrapper).toContain('activateTab("leaves", () => scrollToHeading("Wnioski do decyzji"))');
    expect(wrapper).toContain('type === "leave_entitlement"');
    expect(wrapper).toContain('scrollToHeading(`Limit urlopowy ${props.data.year}`)');
    expect(wrapper).toContain('activateTab("compliance", () => scrollToHeading("Uprawnienia, badania i BHP"))');
  });

  it("renders exactly one subtle affordance from the action data hook", () => {
    expect(css).toContain('[data-hr-action-index]::after{content:"Otwórz →"');
    expect(css).not.toContain('[class*="alertList"] [class*="alert"]::after');
    expect(css).toContain('background:#fff;color:#6b7280');
    expect(css).toContain('box-shadow:none');
    expect(css).toContain('[data-hr-action-index]:focus-visible');
  });
});
