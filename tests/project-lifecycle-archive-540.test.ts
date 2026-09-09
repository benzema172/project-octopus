import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Project lifecycle & archive core 5.5", () => {
  it("keeps completed and archived projects protected while preserving the same project_id", () => {
    const migration = source("supabase/migrations/20260909124000_project_lifecycle_archive_core_540.sql");
    const cleanup = source("supabase/migrations/20260909124100_project_lifecycle_update_cleanup_541.sql");
    expect(migration).toContain("completed_at timestamptz");
    expect(migration).toContain("archived_at timestamptz");
    expect(migration).toContain("guard_project_operational_write_540");
    expect(cleanup).toContain("old.project_id is distinct from new.project_id");
  });

  it("changes project status directly without checklist or blocker requirements", () => {
    const migration = source("supabase/migrations/20260909134000_project_status_direct_control_550.sql");
    const api = source("app/api/projects/status/route.ts");
    const control = source("components/projects/project-status-control-550.tsx");
    expect(migration).toContain("change_project_status_atomic_550");
    expect(migration).not.toContain("get_project_lifecycle_readiness_540");
    expect(migration).not.toContain("closeout_requirements");
    expect(migration).toContain("p_status text");
    expect(api).toContain('db.rpc("change_project_status_atomic_550"');
    expect(control).toContain('/api/projects/status');
    expect(control).toContain('label: "Zakończona"');
    expect(control).toContain('label: "Archiwum"');
  });

  it("closes current HR allocations when a project becomes completed or archived", () => {
    const migration = source("supabase/migrations/20260909134000_project_status_direct_control_550.sql");
    expect(migration).toContain("update public.assignments");
    expect(migration).toContain("update public.hr_teams");
    expect(migration).toContain("v_target in ('completed','archived')");
    expect(migration).toContain("date_to = current_date");
  });

  it("lets archived projects be restored through the same status control", () => {
    const control = source("components/projects/project-status-control-550.tsx");
    const portfolio = source("components/projects/company-investments-view.tsx");
    const layout = source("app/workspace/projects/[projectId]/layout.tsx");
    expect(control).toContain("Przywrócić inwestycję z Archiwum do listy Zakończonych");
    expect(control).toContain("Przywrócić inwestycję do bieżącej pracy");
    expect(portfolio).toContain("można przywrócić");
    expect(layout).toContain("aby przywrócić ją jako Zakończoną albo Aktywną");
  });

  it("uses the status badge itself as the editor in project header and portfolio", () => {
    const layout = source("app/workspace/projects/[projectId]/layout.tsx");
    const portfolio = source("components/projects/company-investments-view.tsx");
    expect(layout).toContain("ProjectStatusControl550");
    expect(layout).toContain('variant="header"');
    expect(portfolio).toContain("ProjectStatusControl550");
    expect(portfolio).toContain('variant="portfolio"');
    expect(portfolio).toContain('data-project-lifecycle-portfolio="550"');
  });

  it("keeps closeout checklist informational instead of blocking status changes", () => {
    const closeout = source("components/projects/closeout-workspace.tsx");
    const page = source("app/workspace/projects/[projectId]/closeout/page.tsx");
    expect(closeout).toContain("nie zależy od checklisty ani otwartych procesów");
    expect(closeout).toContain("nie blokują zmiany statusu inwestycji");
    expect(closeout).not.toContain("Zatwierdź i zakończ inwestycję");
    expect(page).toContain("Nie jest to warunek zmiany statusu ani zakończenia inwestycji");
  });

  it("separates current, completed and archived projects in the portfolio", () => {
    const portfolio = source("components/projects/company-investments-view.tsx");
    expect(portfolio).toContain('type PortfolioFilter = "current" | "attention" | "completed" | "archived" | "all"');
    expect(portfolio).toContain('{ value: "archived", label: "Archiwum" }');
    expect(portfolio).toContain('project.status !== "archived"');
    expect(portfolio).toContain("Otwórz archiwum");
  });

  it("removes completed and archived projects from HR operational selectors", () => {
    const guard = source("components/company/hr/hr-operational-project-guard-540.tsx");
    const migration = source("supabase/migrations/20260909124000_project_lifecycle_archive_core_540.sql");
    expect(guard).toContain('new Set(["preparation", "active"])');
    expect(guard).toContain("option.hidden");
    expect(guard).toContain("selectedBlocked");
    expect(migration).toContain("Wybrana inwestycja nie jest dostępna do bieżącej pracy");
  });

  it("keeps completed and archived workspaces non-operational until restored", () => {
    const layout = source("app/workspace/projects/[projectId]/layout.tsx");
    expect(layout).toContain('const lifecycleReadOnly = ["completed", "archived"]');
    expect(layout).toContain("data-project-readonly-banner=\"540\"");
    expect(layout).toContain("Nie można jej wybierać do nowych wpisów operacyjnych");
    expect(layout).toContain("const canUpload = !lifecycleReadOnly && canManageStatus");
  });
});
