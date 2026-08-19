import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("post-merge performance contract", () => {
  it("keeps authenticated server hot paths on verified JWT claims", () => {
    const auth = read("lib/auth.ts");
    const proxy = read("proxy.ts");

    expect(auth).toContain("auth.getClaims()");
    expect(auth).toContain("auth.getClaims(token)");
    expect(auth).not.toContain("auth.getUser(");
    expect(proxy).toContain("auth.getClaims()");
    expect(proxy).not.toContain("auth.getUser(");
  });

  it("reuses the stateless service client instead of recreating it for every loader", () => {
    const service = read("lib/supabase/service.ts");

    expect(service).toContain("let serviceClient");
    expect(service).toContain("if (serviceClient)");
    expect(service).toContain("detectSessionInUrl: false");
  });

  it("bounds project reads to the fields actually rendered", () => {
    const projects = read("lib/data/projects.ts");

    expect(projects).toContain("PROJECT_COLUMNS");
    expect(projects).toContain("id, workspace_id, name, description, investor_name, general_contractor, location, status, created_at, updated_at");
    expect(projects).not.toContain('.select("*")');
    expect(projects).toContain("export const listProjectsForWorkspace = cache(");
    expect(projects).toContain("export const listProjectsForUser = cache(");
  });

  it("deduplicates repeated workspace reads within a render", () => {
    const workspace = read("lib/data/workspace.ts");

    expect(workspace).toContain("export const listCompanyWorkspacesForUser = cache(");
    expect(workspace).toContain("export const isCompanyProfileSchemaReady = cache(");
  });

  it("loads dashboard and Brain styles only on routes that need them", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    const dashboard = read("app/workspace/projects/[projectId]/page.tsx");
    const brain = read("app/workspace/projects/[projectId]/brain/page.tsx");

    expect(layout).not.toContain("project-dashboard-combined.css");
    expect(layout).not.toContain("project-dashboard-compact.css");
    expect(layout).not.toContain("project-dashboard-layout-refinement.css");
    expect(layout).not.toContain("brain-knowledge.css");
    expect(layout).toContain("project-intake.css");

    expect(dashboard).toContain("project-dashboard-combined.css");
    expect(dashboard).toContain("project-dashboard-compact.css");
    expect(dashboard).toContain("project-dashboard-layout-refinement.css");
    expect(brain).toContain("brain-knowledge.css");
  });
});
