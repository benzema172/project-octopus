import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDemoDataset } from "../lib/demo/dataset";
import { omitNullDatabaseDefaults } from "../lib/demo/seed-defaults";

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
    const packageJson = read("package.json");

    expect(ci).toContain("node-version: 24");
    expect(e2e).toContain("node-version: 24");
    expect(packageJson).toContain('"node": "24.x"');
    expect(ci).toContain("npm audit --omit=dev --audit-level=high");
    expect(e2e).toContain("node scripts/e2e-live-audit.mjs");
    expect(e2e).not.toContain("secrets.");
    expect(liveAudit).toContain("/api/storage/upload-url");
    expect(liveAudit).toContain("/api/brain/process-document");
    expect(liveAudit).toContain("octopus-live-audit.xlsx");
  });

  it("keeps current and legacy workspace creation compatible with the required creator", () => {
    const guestServer = read("lib/demo/guest-server.ts");
    const workspace = read("lib/data/workspace.ts");
    const migration = read("supabase/migrations/20260819102823_workspace_creator_compatibility.sql");

    expect(guestServer).toContain("DEMO_WORKSPACE_ID");
    expect(guestServer).toContain("created_by: guest.id");
    expect(guestServer).toContain("owner_id: guest.id");
    expect(guestServer.indexOf("workspaceBootstrapError")).toBeLessThan(guestServer.indexOf("seedGuestDemoData(guest.id)"));
    expect(workspace).toContain("created_by: user.id");
    expect(workspace).toContain("owner_id: user.id");
    expect(migration).toContain("before insert on public.workspaces");
    expect(migration).toContain("coalesce(new.owner_id, (select auth.uid()))");
  });

  it("keeps the guest seed aligned with current required production columns", () => {
    const seed = read("lib/demo/seed.ts");

    expect(seed).toContain('project_facts: ["id", "project_id", "fact_type", "subject"');
    expect(seed).toContain('documents: ["id", "workspace_id", "project_id", "title", "document_type"');
    expect(seed).toContain('"amount", "original_amount"');
    expect(seed).toContain('templates: ["id", "workspace_id", "name", "template_type", "object_provider", "object_key"');
    expect(seed).toContain("subject: row.subject ?? row.value_text ?? row.fact_type");
    expect(seed).toContain('title: row.title ?? row.name ?? "Dokument demonstracyjny"');
    expect(seed).toContain('document_type: row.document_type ?? row.category ?? "other"');
    expect(seed).toContain("original_amount: row.original_amount ?? row.amount");
    expect(seed).toContain('object_provider: "demo"');
    expect(seed).toContain('object_key: `demo/templates/${id}.json`');
    expect(seed).toContain("omitNullDatabaseDefaults(table, pick(row, columns))");
  });

  it("lets PostgreSQL defaults replace only legacy nulls on NOT NULL default-backed fields", () => {
    const document = omitNullDatabaseDefaults("documents", {
      title: "Dokument audytowy",
      created_at: null,
      updated_at: null,
      ai_status: null,
      deleted_at: null
    });
    expect(document.title).toBe("Dokument audytowy");
    expect(Object.prototype.hasOwnProperty.call(document, "created_at")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(document, "updated_at")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(document, "ai_status")).toBe(false);
    expect(document.deleted_at).toBeNull();

    const project = omitNullDatabaseDefaults("projects", { status: null, description: null });
    expect(Object.prototype.hasOwnProperty.call(project, "status")).toBe(false);
    expect(project.description).toBeNull();

    const notification = omitNullDatabaseDefaults("notifications", { severity: null, created_at: null, read_at: null });
    expect(Object.prototype.hasOwnProperty.call(notification, "severity")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(notification, "created_at")).toBe(false);
    expect(notification.read_at).toBeNull();
  });

  it("generates demo data that conforms to every enum-backed production field", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const dataset = buildDemoDataset(userId, new Date("2026-08-19T12:00:00Z"));
    const projectStatuses = new Set(["tender", "preparation", "active", "paused", "completed", "archived"]);
    const reviewStatuses = new Set(["draft", "ai_ready", "in_review", "sent", "approved", "rejected", "archived"]);
    const workspaceRoles = new Set(["owner", "admin", "manager", "member", "viewer"]);
    const severities = new Set(["info", "low", "medium", "high", "critical", "warning"]);

    expect(dataset.workspace.created_by).toBe(userId);
    expect(dataset.workspace.owner_id).toBe(userId);
    expect(dataset.projects.length).toBeGreaterThan(0);

    for (const project of dataset.projects) {
      expect(projectStatuses.has(String(project.status))).toBe(true);
      expect(project.created_by).toBe(userId);
    }
    for (const member of dataset.workspaceMembers) {
      expect(workspaceRoles.has(String(member.role))).toBe(true);
    }
    for (const row of [...dataset.materialRequests, ...dataset.protocols, ...dataset.materials, ...dataset.devices]) {
      if (row.status == null) continue;
      expect(reviewStatuses.has(String(row.status))).toBe(true);
    }
    for (const finding of dataset.aiFindings) {
      expect(severities.has(String(finding.severity))).toBe(true);
      if (finding.status != null) expect(reviewStatuses.has(String(finding.status))).toBe(true);
    }

    const projectProfiles = dataset.projectFacts.filter((row) => row.fact_type === "project_profile");
    for (const fact of projectProfiles) {
      if (!fact.value_json || typeof fact.value_json !== "object" || Array.isArray(fact.value_json)) continue;
      expect((fact.value_json as Record<string, unknown>).status).not.toBe("planned");
    }
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
