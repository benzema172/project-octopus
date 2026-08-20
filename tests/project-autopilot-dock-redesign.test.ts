import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("project Autopilot dock redesign", () => {
  it("surfaces health, attention, blockers, AI capacity and the next action", () => {
    const component = read("components/projects/project-autopilot-dock.tsx");
    expect(component).toContain("summary.healthScore");
    expect(component).toContain("summary.attentionCount");
    expect(component).toContain("summary.blockerCount");
    expect(component).toContain("summary.aiCanDoCount");
    expect(component).toContain("summary.nextTitle");
    expect(component).toContain("Stan inwestycji");
    expect(component).toContain("Rekomendowany następny krok");
  });

  it("uses a compact four-zone status card instead of a flat metric strip", () => {
    const css = read("components/projects/project-autopilot-dock.module.css");
    expect(css).toContain("grid-template-columns:minmax(300px,1.1fr) minmax(150px,.52fr) minmax(340px,1.05fr) minmax(310px,1fr)");
    expect(css).toContain(".dockHealthRing");
    expect(css).toContain("conic-gradient");
    expect(css).toContain(".dockSignals");
    expect(css).toContain(".dockNext");
  });
});
