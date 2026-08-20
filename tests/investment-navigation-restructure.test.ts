import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const navigation = readFileSync("components/projects/project-navigation.tsx", "utf8");

describe("investment navigation structure", () => {
  it("removes Plan as a top-level navigation group", () => {
    expect(navigation).not.toContain('key: "plan"');
    expect(navigation).not.toContain('label: "Plan",\n      icon: CalendarDays');
  });

  it("moves BOQ and Schedule into Realizacja", () => {
    const executionStart = navigation.indexOf('key: "execution"');
    const resourcesStart = navigation.indexOf('key: "resources"');
    const execution = navigation.slice(executionStart, resourcesStart);

    expect(execution).toContain('label: "Kosztorys / BOQ"');
    expect(execution).toContain('label: "Harmonogram"');
  });

  it("removes Finanse from Zasoby and exposes it as a direct top-level item", () => {
    const resourcesStart = navigation.indexOf('key: "resources"');
    const controlStart = navigation.indexOf('key: "control"');
    const resources = navigation.slice(resourcesStart, controlStart);

    expect(resources).not.toContain('label: "Finanse"');
    expect(navigation).toContain('const finance: ProjectNavItem = { href: `${base}/finance`, label: "Finanse"');
    expect(navigation).toContain('className="pw-nav-dashboard pw-nav-finance"');
  });
});
