import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("post-change reliability and performance hardening", () => {
  it("keeps Control 360 backend snapshots isolated and Autopilot compact", () => {
    const source = read("lib/data/control-snapshot.ts");
    const splitMigration = read("supabase/migrations/20260818134500_split_control_360_panel_snapshots.sql");
    const compactMigration = read("supabase/migrations/20260818141500_dashboard_compact_autopilot.sql");
    expect(source).toContain('rpc("get_project_command_panel_snapshot"');
    expect(source).toContain('rpc("get_project_reconciliation_snapshot"');
    expect(source).toContain('rpc("get_project_execution_snapshot"');
    expect(source).toContain('rpc("get_project_autopilot_compact_snapshot"');
    expect(source).not.toContain('rpc("get_project_control_snapshot"');
    expect(compactMigration).toContain("get_project_autopilot_compact_snapshot");
    expect(compactMigration).toContain("limit 120");
    expect(compactMigration).toContain("boq_anomalies");
    expect(compactMigration).not.toContain("limit 3000");
    expect(splitMigration).toContain("to service_role");
  });

  it("does not make lightweight panels wait for the project Autopilot summary", () => {
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).toContain("<Suspense fallback={null}>");
    expect(layout).toContain("AsyncProjectAutopilotDock");
    expect(layout).toContain("Promise.all([");
  });

  it("uses one lightweight dashboard RPC instead of dashboard table fan-out", () => {
    const page = read("app/workspace/projects/[projectId]/page.tsx");
    const loader = read("lib/data/project-dashboard-snapshot.ts");
    expect(page).toContain("getProjectDashboardSnapshot");
    expect(page).not.toContain('.from("boq_versions")');
    expect(page).not.toContain('.from("progress_entries")');
    expect(page).not.toContain('.from("forecast_snapshots")');
    expect(loader).toContain('rpc("get_project_dashboard_snapshot"');
  });

  it("paginates company operational roots and scopes child reads to visible ids", () => {
    const source = read("lib/data/company-operations.ts");
    expect(source).toContain(".range(page.from, page.to)");
    expect(source).toContain(".in(\"invoice_id\", invoiceIds)");
    expect(source).toContain(".in(\"employee_id\", employeeIds)");
    expect(source).toContain("getStockBalancesForItems(workspaceId, itemIds)");
    expect(source).toContain(".in(\"vehicle_id\", vehicleIds)");
    expect(source).toContain('rpc("get_company_operations_summary"');
  });

  it("splits company modules and defers Power Tools until the user asks for them", () => {
    const lazy = read("components/company/company-operations-lazy.tsx");
    const deferred = read("components/company/company-power-tools-deferred.tsx");
    expect(lazy).toContain('dynamic(()=>import("@/components/company/operations/finance-operations")');
    expect(lazy).toContain('dynamic(()=>import("@/components/company/operations/warehouse-operations")');
    expect(lazy).toContain('dynamic(()=>import("@/components/company/operations/fleet-operations")');
    expect(lazy).not.toContain("hr-operations");
    expect(deferred).toContain("/api/company/power-data");
    expect(deferred).toContain("Narzędzia zaawansowane");
  });

  it("scopes Autopilot AI Inbox to one investment", () => {
    const source = read("lib/data/project-ai-inbox.ts");
    const control = read("lib/data/control-snapshot.ts");
    expect(source).toContain('.eq("proposed_project_id",projectId)');
    expect(source).toContain('.eq("project_id",projectId)');
    expect(source).toContain('.eq("source_project_id",projectId)');
    expect(control).toContain("listProjectAiInbox(workspaceId,projectId,80)");
    expect(control).not.toContain("listAiInbox(workspaceId)");
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

  it("scopes selector and investments refinement CSS to routes", () => {
    const layout = read("app/workspace/layout.tsx");
    const selector = read("app/workspace/page.tsx");
    const investments = read("app/workspace/companies/[workspaceId]/investments/page.tsx");
    const finances = read("app/workspace/companies/[workspaceId]/finances/page.tsx");
    const projectLayout = read("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).not.toContain("company-selector-refinement.css");
    expect(layout).not.toContain("investments-refinement.css");
    expect(layout).not.toContain("finance-compact.css");
    expect(layout).not.toContain("layout-density-project-audit.css");
    expect(selector).toContain("company-selector-refinement.css");
    expect(investments).toContain("investments-refinement.css");
    expect(finances).toContain("finance-compact.css");
    expect(projectLayout).toContain("layout-density-project-audit.css");
  });

  it("removes broad legacy ALL policies from investment and document data", () => {
    const migration = read("supabase/migrations/20260818142500_consolidate_domain_rls.sql");
    const progress = read("supabase/migrations/20260818142600_progress_domain_rls.sql");
    expect(migration).toContain("drop policy if exists documents_project_access");
    expect(migration).toContain("document_versions_domain_insert");
    expect(migration).toContain("has_domain_access(p.workspace_id,''investments'',''write'',p.id)");
    expect(progress).toContain("progress_entries_investment_read");
    expect(progress).toContain("progress_entries_investment_update");
  });

  it("keeps Wysoka demo bootstrap removed", () => {
    const workspaceLayout = read("app/workspace/layout.tsx");
    expect(workspaceLayout).not.toContain("WysokaDemoBootstrap");
    expect(workspaceLayout).not.toContain("wysoka-seed");
  });
});
