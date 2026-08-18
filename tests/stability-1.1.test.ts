import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root=process.cwd();
const read=(path:string)=>readFileSync(resolve(root,path),"utf8");

describe("Project Octopus 1.1 operating scale",()=>{
  it("refreshes anomalies only when stale or invalidated",()=>{
    const sql=read("supabase/migrations/20260818100000_110_operating_scale.sql");
    const data=read("lib/data/project-command-center.ts");
    expect(sql).toContain("create table if not exists public.project_runtime_state");
    expect(sql).toContain("refresh_project_anomalies_if_stale");
    expect(data).toContain('.rpc("refresh_project_anomalies_if_stale"');
    expect(data).not.toContain('.rpc("refresh_project_anomalies"');
  });

  it("separates purchase cost from revenue and exposes allocation coverage",()=>{
    const sql=read("supabase/migrations/20260818100000_110_operating_scale.sql");
    expect(sql).toContain("get_company_finance_kpis");
    expect(sql).toContain("filter(where direction='purchase')");
    expect(sql).toContain("'allocatedRevenue'");
    expect(sql).toContain("'financeCoverage'");
    expect(sql).toContain("exists(select 1 from public.financial_allocations fa");
    expect(sql).toContain("allocationCoveragePct");
  });

  it("generates report snapshots atomically from server-side aggregates",()=>{
    const sql=read("supabase/migrations/20260818100000_110_operating_scale.sql");
    expect(sql).toContain("generate_report_snapshot_atomic");
    const route=read("app/api/company/records/route.ts");
    expect(route).toContain('.rpc("generate_report_snapshot_atomic"');
    expect(sql).toContain("insert into public.report_runs");
    expect(sql).toContain("insert into public.report_snapshots");
    expect(sql).toContain("report.generated_atomic");
  });

  it("uses indexed full-text company search and includes company knowledge",()=>{
    const sql=read("supabase/migrations/20260818100000_110_operating_scale.sql");
    const ui=read("components/company/company-search.tsx");
    expect(sql).toContain("projects_search_fts_idx");
    expect(sql).toContain("invoices_search_fts_idx");
    expect(sql).toContain("to_tsvector('simple'");
    expect(sql).toContain("'knowledge',ke.id");
    expect(ui).toContain('knowledge: "Wiedza firmy"');
  });

  it("makes Project Health explainable and treats financial coverage as data confidence",()=>{
    const data=read("lib/data/project-command-center.ts");
    const ui=read("components/projects/project-command-center.tsx");
    expect(data).toContain("deductions: HealthDeduction[]");
    expect(data).toContain("dataConfidence");
    expect(ui).toContain("Project Health · wskaźnik operacyjny");
    expect(ui).toContain("Pokrycie alokacją");
    expect(ui).toContain("Scenariusz ostrożny");
  });

  it("publishes 1.1.0 metadata and the full 23-migration validator",()=>{
    const release=read("lib/app-release.ts");
    const pkg=JSON.parse(read("package.json")) as {version:string;scripts:Record<string,string>};
    const validator=read("scripts/validate-migrations-110.mjs");
    expect(release).toContain('version: "1.1.0"');
    expect(pkg.version).toBe("1.1.0");
    expect(pkg.scripts["test:migrations"]).toContain("validate-migrations-110.mjs");
    expect(validator).toContain("20260818090000_102_stability.sql");
    expect(validator).toContain("20260818100000_110_operating_scale.sql");
    expect(validator).toContain("full migration chain: ${migrations.length} migrations");
  });
});
