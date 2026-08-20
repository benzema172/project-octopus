import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Compact disclosure system", () => {
  it("provides a reusable three-column disclosure control with click-to-close behavior", () => {
    const component = read("components/ui/compact-disclosure-group.tsx");
    const css = read("app/compact-disclosures.css");
    expect(component).toContain("current === item.id ? null : item.id");
    expect(component).toContain("aria-expanded");
    expect(component).toContain("window.location.hash");
    expect(css).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
  });

  it("uses the compact disclosure row in BOQ and Schedule", () => {
    const boq = read("app/workspace/projects/[projectId]/cost-estimate/page.tsx");
    const schedule = read("app/workspace/projects/[projectId]/schedule/page.tsx");
    expect(boq).toContain("CompactDisclosureGroup");
    expect(boq).toContain('id: "boq-change-order"');
    expect(boq).not.toContain('<details className="pw-boq-tool">');
    expect(schedule).toContain("CompactDisclosureGroup");
    expect(schedule).toContain('id: "schedule-add-task"');
  });

  it("applies the same control pattern to Control 360 disclosures", () => {
    const command = read("components/projects/project-command-center.tsx");
    const reconciliation = read("components/projects/project-reconciliation-graph.tsx");
    expect(command).toContain("CompactDisclosureGroup");
    expect(reconciliation).toContain("CompactDisclosureGroup");
    expect(reconciliation).toContain("defaultOpenId");
  });

  it("loads the disclosure styling globally", () => {
    expect(read("app/layout.tsx")).toContain('import "./compact-disclosures.css"');
  });
});
