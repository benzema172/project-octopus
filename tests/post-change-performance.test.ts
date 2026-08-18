import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("post-change reliability and performance hardening", () => {
  it("keeps Control 360 backend snapshots isolated by panel", () => {
    const source = read("lib/data/control-snapshot.ts");
    const migration = read("supabase/migrations/20260818134500_split_control_360_panel_snapshots.sql");
    expect(source).toContain('rpc("get_project_command_panel_snapshot"');
    expect(source).toContain('rpc("get_project_reconciliation_snapshot"');
    expect(source).toContain('rpc("get_project_execution_snapshot"');
    expect(source).toContain('rpc("get_project_autopilot_snapshot"');
    expect(source).not.toContain('rpc("get_project_control_snapshot"');
    expect(migration).toContain("p_include_finance");
    expect(migration).toContain("p_include_warehouse");
    expect(migration).toContain("grant execute on function public.get_project_autopilot_snapshot");
    expect(migration).toContain("to service_role");
  });

  it("does not make lightweight panels wait for the project Autopilot summary", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).toContain("<Suspense fallback={null}>");
    expect(layout).toContain("AsyncProjectAutopilotDock");
    expect(layout).toContain("Promise.all([");
  });

  it("filters project document categories in SQL and avoids wildcard document payloads", () => {
    const documents = read("lib/data/documents.ts");
    expect(documents).toContain('.in("category", normalizedCategories)');
    expect(documents).toContain("DOCUMENT_WITH_VERSIONS_SELECT");
    expect(documents).not.toContain('select("*, document_versions');
  });

  it("aggregates 13-week cashflow by week instead of rescanning sources per week", () => {
    const migration = read("supabase/migrations/20260818133500_post_change_performance_hardening.sql");
    expect(migration).toContain("invoice_cash as");
    expect(migration).toContain("commitment_cash as");
    expect(migration).toContain("coalesce(cm.expected_date,b.week_start)");
    expect(migration).not.toContain("left join lateral (select coalesce(sum(greatest(i.gross_amount-i.paid_amount,0))");
  });

  it("keeps Wysoka demo bootstrap removed", () => {
    const workspaceLayout = read("app/workspace/layout.tsx");
    expect(workspaceLayout).not.toContain("WysokaDemoBootstrap");
    expect(workspaceLayout).not.toContain("wysoka-seed");
  });
});
