import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Warehouse Project Scope Core 4", () => {
  it("keeps the full project dictionary for historical warehouse labels", () => {
    const market = source("lib/data/warehouse-market-400.ts");
    expect(market).toContain("projects: (base.projects ?? []) as Row[]");
    expect(market).toContain("activeWarehouseProjects: activeProjects");
  });

  it("uses only assignable projects in planning and new warehouse assignments", () => {
    const marketUi = source("components/company/warehouse-market-410.tsx");
    const workspace = source("components/company/warehouse-workspace-300.tsx");
    const movementTruth = source("components/company/warehouse-movement-truth-531.tsx");

    expect(marketUi).toContain("data.activeWarehouseProjects ?? data.projects");
    expect(workspace).toContain("const assignableProjects");
    expect(workspace).toContain("projects={assignableProjects}");
    expect(movementTruth).toContain("data.activeWarehouseProjects ?? data.projects");
  });

  it("enriches historical movements from all projects but returns only active/preparation projects for routing", () => {
    const route = source("app/api/company/warehouse-movement-flow/route.ts");

    expect(route).toContain("const projectById = new Map(((projectsResult.data ?? []) as Row[])");
    expect(route).toContain('["active", "preparation"].includes(String(row.status))');
    expect(route).toContain("project_name: projectById.get");
  });
});
