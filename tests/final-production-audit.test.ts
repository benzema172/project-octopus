import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("final production audit contract", () => {
  it("keeps workspace-only styles out of the anonymous root route", () => {
    const rootLayout = read("app/layout.tsx");
    const workspaceLayout = read("app/workspace/layout.tsx");

    expect(rootLayout).not.toContain("octopus-app.css");
    expect(rootLayout).not.toContain("octopus-1-release.css");
    expect(workspaceLayout).toContain("../octopus-app.css");
    expect(workspaceLayout).toContain("../octopus-1-release.css");
  });

  it("does not expose the framework header", () => {
    expect(read("next.config.mjs")).toContain("poweredByHeader: false");
  });

  it("routes atomic warehouse mutations directly instead of parsing bodies in proxy", () => {
    const shell = read("components/company/operations/module-shell.tsx");
    const proxy = read("proxy.ts");

    expect(shell).toContain("ATOMIC_WAREHOUSE_ENTITIES");
    expect(shell).toContain("/api/company/warehouse-atomic");
    expect(proxy).not.toContain("request.clone().json");
    expect(proxy).not.toContain("NextResponse.rewrite");
  });

  it("replaces the legacy company monolith with a thin lazy compatibility adapter", () => {
    const adapter = read("components/company/company-operations-workspace.tsx");

    expect(adapter).toContain("dynamic(() => import");
    expect(adapter).toContain("reports-operations");
    expect(adapter).not.toContain("function Finance(");
    expect(adapter.length).toBeLessThan(4_000);
  });

  it("keeps CI and E2E on Node 24 with dependency and black-box integration gates", () => {
    const ci = read(".github/workflows/ci.yml");
    const e2e = read(".github/workflows/e2e-staging.yml");
    const liveAudit = read("scripts/e2e-live-audit.mjs");

    expect(ci).toContain("node-version: 24");
    expect(e2e).toContain("node-version: 24");
    expect(ci).toContain("npm audit --omit=dev --audit-level=high");
    expect(e2e).toContain("node scripts/e2e-live-audit.mjs");
    expect(e2e).not.toContain("secrets.");
    expect(liveAudit).toContain("/api/storage/upload-url");
    expect(liveAudit).toContain("/api/brain/process-document");
    expect(liveAudit).toContain("octopus-live-audit.xlsx");
  });

  it("repairs the deterministic guest workspace before seeding legacy demo rows", () => {
    const guestServer = read("lib/demo/guest-server.ts");

    expect(guestServer).toContain("DEMO_WORKSPACE_ID");
    expect(guestServer).toContain("created_by: guest.id");
    expect(guestServer).toContain("owner_id: guest.id");
    expect(guestServer.indexOf("workspaceBootstrapError")).toBeLessThan(guestServer.indexOf("seedGuestDemoData(guest.id)"));
  });

  it("aligns legacy project RLS with investments domain access without depending on schema drift", () => {
    const migration = read("supabase/migrations/20260819100451_final_audit_project_access.sql");

    expect(migration).toContain("has_domain_access(p.workspace_id, 'investments', 'read', p.id)");
    expect(migration).toContain("has_domain_access(workspace_id, 'investments', 'write', id)");
    expect(migration).not.toContain("join public.workspace_members wm");
    expect(migration).toContain("to_regclass('public.project_systems') is not null");
    expect(migration).toContain("project_tasks_delete");
    expect(migration).toContain("boq_imports_delete");
  });
});
