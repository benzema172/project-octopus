import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Project lifecycle & archive core 5.4", () => {
  it("keeps completed and archived projects immutable while preserving the same project_id", () => {
    const migration = source("supabase/migrations/20260909124000_project_lifecycle_archive_core_540.sql");
    const cleanup = source("supabase/migrations/20260909124100_project_lifecycle_update_cleanup_541.sql");
    expect(migration).toContain("completed_at timestamptz");
    expect(migration).toContain("archived_at timestamptz");
    expect(migration).toContain("guard_project_operational_write_540");
    expect(migration).toContain("Dane historyczne są tylko do odczytu");
    expect(cleanup).toContain("old.project_id is distinct from new.project_id");
  });

  it("requires operational readiness before closeout and auto-closes HR allocations", () => {
    const migration = source("supabase/migrations/20260909124000_project_lifecycle_archive_core_540.sql");
    const readiness = source("supabase/migrations/20260909124200_project_lifecycle_readiness_workspace_compat_542.sql");
    expect(migration).toContain("get_project_lifecycle_readiness_540");
    expect(migration).toContain("update public.assignments");
    expect(migration).toContain("update public.hr_teams");
    expect(migration).toContain("status='completed'");
    expect(readiness).toContain("pendingPurchaseOrders");
    expect(readiness).toContain("draftStockMovements");
  });

  it("archives a completed investment without moving or deleting its documents", () => {
    const migration = source("supabase/migrations/20260909124000_project_lifecycle_archive_core_540.sql");
    const api = source("app/api/projects/closeout/route.ts");
    const closeout = source("components/projects/closeout-workspace.tsx");
    expect(migration).toContain("archive_project_atomic");
    expect(migration).toContain("status='archived'");
    expect(api).toContain('action?: "set_requirement" | "generate" | "approve" | "archive"');
    expect(api).toContain('db.rpc("archive_project_atomic"');
    expect(closeout).toContain("Przenieś do Archiwum");
    expect(closeout).toContain("pod tym samym ID inwestycji");
  });

  it("separates current, completed and archived projects in the portfolio", () => {
    const portfolio = source("components/projects/company-investments-view.tsx");
    expect(portfolio).toContain('type PortfolioFilter = "current" | "attention" | "completed" | "archived" | "all"');
    expect(portfolio).toContain('{ value: "archived", label: "Archiwum" }');
    expect(portfolio).toContain('project.status !== "archived"');
    expect(portfolio).toContain("Otwórz archiwum");
  });

  it("removes closed projects from HR operational selectors but preserves historical context", () => {
    const guard = source("components/company/hr/hr-operational-project-guard-540.tsx");
    const core = source("components/company/hr/hr-workspace-core-300.tsx");
    const migration = source("supabase/migrations/20260909124000_project_lifecycle_archive_core_540.sql");
    expect(guard).toContain('new Set(["preparation", "active"])');
    expect(guard).toContain("option.hidden");
    expect(guard).toContain("selectedBlocked");
    expect(core).toContain("HrOperationalProjectGuard540");
    expect(migration).toContain("Wybrana inwestycja nie jest dostępna do bieżącej pracy");
  });

  it("marks the whole project workspace read-only after completion or archive", () => {
    const layout = source("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).toContain('const lifecycleReadOnly = ["completed", "archived"]');
    expect(layout).toContain("data-project-readonly-banner=\"540\"");
    expect(layout).toContain("Archiwum inwestycji — tylko do odczytu");
    expect(layout).toContain("!lifecycleReadOnly && domainAccessPolicyAllows");
  });
});
