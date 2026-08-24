import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const route = (name: string) => read(`app/workspace/projects/[projectId]/${name}/page.tsx`);

describe("compact investment submodules after Schedule", () => {
  it("removes generic presentation foundations from every remaining route", () => {
    for (const name of ["site", "progress", "requests", "protocols", "team", "warehouse", "reports", "closeout", "outputs"]) {
      const page = route(name);
      expect(page).not.toContain("ProjectModuleFoundation");
      expect(page).not.toContain("ProjectModulePage");
      expect(page).toContain("ProjectCompact");
    }
  });

  it("keeps functional registers visible and moves creation tools into disclosures", () => {
    expect(route("site")).toContain("<details className=\"pw-submodule-tool\"");
    expect(route("site")).toContain("<SiteEventForm");
    expect(route("progress")).toContain('kind="progress"');
    expect(route("progress").match(/pw-submodule-tool/g)?.length).toBeGreaterThanOrEqual(2);
    expect(route("requests")).toContain("<MaterialRequestsWorkflow");
    expect(route("requests")).toContain("<MaterialRequestIntegrityPanel");
    expect(route("protocols")).toContain("<ProtocolsProPanel");
    expect(route("team")).toContain('kind="team"');
    expect(route("warehouse")).toContain('kind="warehouse"');
    expect(route("reports")).toContain('kind="reports"');
  });

  it("collapses long WM and protocol input forms without hiding their live registers", () => {
    const requests = read("components/projects/material-requests-workflow.tsx");
    const protocols = read("components/projects/protocols-pro-panel.tsx");
    for (const component of [requests, protocols]) {
      expect(component).toContain('className="pw-submodule-tool pw-submodule-tool--nested"');
      expect(component).toContain('className="project-live-records"');
    }
  });

  it("uses one responsive compact shell and the 10px project rhythm", () => {
    const css = read("app/project-submodules-compact.css");
    const layout = read("app/workspace/projects/[projectId]/layout.tsx");
    expect(css).toContain(".pw-submodule-compact {");
    expect(css).toContain("gap: 10px;");
    expect(css).toContain(".pw-submodule-tool > :is(.project-operation-card,.ops-panel)");
    expect(css).toContain("@media (max-width: 520px)");
    expect(layout).toContain('import "../../../project-submodules-compact.css";');
  });

  it("compacts closeout and outputs while preserving exports and approval controls", () => {
    const closeout = route("closeout");
    const workspace = read("components/projects/closeout-workspace.tsx");
    const outputs = route("outputs");
    expect(closeout).toContain("Aktualizuj checklistę");
    expect(workspace).toContain('className="pw-submodule-metrics"');
    expect(outputs).toContain("format=pdf");
    expect(outputs).toContain("format=json");
    expect(outputs).toContain('className="pw-submodule-sources"');
  });

  it("keeps the requests view compatible with the legacy devices schema", () => {
    const migration = read("supabase/migrations/20260824112000_backfill_devices_updated_at.sql");
    const knowledge = read("lib/data/module-knowledge.ts");
    expect(migration).toContain("alter table public.devices");
    expect(migration).toContain("add column if not exists updated_at");
    expect(migration).toContain("create trigger set_devices_updated_at");
    expect(knowledge).toContain('.order("updated_at", { ascending: false })');
  });
});
