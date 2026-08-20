import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Investment Autopilot dashboard visibility", () => {
  it("gates the Autopilot dock to the exact project dashboard route", () => {
    const gate = read("components/projects/project-autopilot-route-gate.tsx");
    expect(gate).toContain("usePathname");
    expect(gate).toContain("`/workspace/projects/${projectId}`");
    expect(gate).toContain("normalizedPath !== dashboardPath");
    expect(gate).toContain("return null");
  });

  it("wraps the shared-layout Autopilot with the dashboard-only route gate", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).toContain("ProjectAutopilotRouteGate");
    expect(layout).toContain("<ProjectAutopilotRouteGate projectId={project.id}>");
    expect(layout).toContain("<AsyncProjectAutopilotDock projectId={project.id} canRun={canUpload} />");
  });
});
