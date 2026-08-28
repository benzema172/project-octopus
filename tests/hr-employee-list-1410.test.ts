import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Project Octopus 1.4.10 — HR employee list regression", () => {
  const page = readFileSync("app/workspace/companies/[workspaceId]/hr/page.tsx", "utf8");
  const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const css = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-employee-list-1410.module.css", "utf8");

  it("keeps the 1.4.1 employee-list polish connected through the calendar wrapper", () => {
    expect(wrapper).toContain('data-hr-workspace-slot="employees-shell"');
    expect(page).toContain("hr-employee-list-1410.module.css");
    expect(page).toContain("regression.hr1410");
    expect(css).toContain('[data-hr-workspace-slot="employees-shell"]');
    expect(css).toContain('content: "LP."');
    expect(css).toContain("content: counter(employee-row)");
    expect(css).toContain("counter-reset: employee-row");
    expect(css).toContain("counter-increment: employee-row");
  });

  it("keeps list styling independent from the add-employee modal", () => {
    expect(css).toContain("[data-hr-employee-list]");
    expect(css).not.toContain(":has(> details)");
    expect(css).toContain("tbody td:first-child > div");
    expect(css).toContain("display: none");
    expect(css).toContain("border-left: 1px solid #eef0f3");
  });
});
