import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateFileSignature } from "../lib/r2/file-signature";
import { matchScore, rankMatches } from "../lib/investments/reconciliation-matcher";

const read = (path: string) => readFileSync(path, "utf8");

describe("0.9.1 file signature hardening", () => {
  it("accepts a real PDF signature and rejects a renamed executable", () => {
    expect(validateFileSignature("faktura.pdf", "application/pdf", Buffer.from("%PDF-1.7\n"))).toBeNull();
    expect(validateFileSignature("faktura.pdf", "application/pdf", Buffer.from("MZfake executable"))).toContain("sygnatury PDF");
  });
  it("recognizes OpenXML/ZIP and blocks binary text", () => {
    expect(validateFileSignature("kosztorys.xlsx", "application/zip", Buffer.from([0x50,0x4b,0x03,0x04,1,2,3]))).toBeNull();
    expect(validateFileSignature("dane.csv", "text/csv", Buffer.from([0x61,0,0x62]))).toContain("binarną");
  });
});

describe("0.9.4 reconciliation ranking", () => {
  it("prefers matching technical description and diameter", () => {
    const results = rankMatches("Rura PP kanalizacyjna DN110 20 m", [
      { id: "a", label: "Rura PP kanalizacyjna DN110", context: "m" },
      { id: "b", label: "Kanał wentylacyjny 400x200", context: "m" }
    ]);
    expect(results[0]?.id).toBe("a");
    expect(results[0]?.score).toBeGreaterThan(0.4);
  });
  it("keeps unrelated candidates low", () => {
    expect(matchScore("centrala wentylacyjna nawiewna", "hydrant wewnętrzny DN25").score).toBeLessThan(0.2);
  });
});

describe("0.9.1–1.0 implementation contracts", () => {
  it("routes critical writes through atomic RPCs", () => {
    const projectRoute = read("app/api/projects/operations/route.ts");
    const companyRoute = read("app/api/company/power/route.ts");
    expect(projectRoute).toContain("create_progress_entry_atomic");
    expect(projectRoute).toContain("create_budget_version_atomic");
    expect(companyRoute).toContain("reassign_invoice_atomic");
    expect(companyRoute).toContain("issue_reservation_atomic");
    expect(companyRoute).toContain("transfer_stock_atomic");
    expect(companyRoute).toContain("record_meter_reading_atomic");
  });

  it("uses the full SQL stock ledger while the primary warehouse page scopes the returned balances", () => {
    expect(read("lib/data/company-operations.ts")).toContain("getStockBalancesForItems(workspaceId, itemIds)");
    expect(read("lib/data/company-power-tools.ts")).toContain("getStockBalances(workspaceId)");
    expect(read("lib/data/stock-balances.ts")).toContain('rpc("get_stock_balances_for_items"');
    expect(read("supabase/migrations/20260817210000_091_reliability_core.sql")).toContain("get_stock_balances");
    expect(read("supabase/migrations/20260818140500_paged_stock_balances.sql")).toContain("get_stock_balances_for_items");
  });

  it("hardens Autopilot with durable source keys and semantic candidates", () => {
    const source = read("lib/investments/run-autopilot.ts");
    expect(source).toContain("generated_source_key");
    expect(source).toContain("candidate_strategy");
    expect(source).toContain('error.code === "23505"');
    expect(source).not.toContain("materials.slice(0, 8)");
  });

  it("captures AI analysis and human review quality", () => {
    const quality = read("supabase/migrations/20260817240000_095_ai_quality.sql");
    const capture = read("supabase/migrations/20260817241000_095_analysis_retry_capture.sql");
    expect(quality).toContain("ai_review_quality_trigger");
    expect(capture).toContain("document_analysis_quality_trigger");
    expect(capture).toContain("source_reference_retry_evidence_cleanup");
  });

  it("provides 1.0 cash flow, resources, correspondence and isolated Control 360 panels", () => {
    const migration = read("supabase/migrations/20260817250000_100_command_center.sql");
    const controlPage = read("app/workspace/projects/[projectId]/control/page.tsx");
    const isolatedPanels = read("components/projects/control-isolated-panels.tsx");
    expect(migration).toContain("project_correspondence");
    expect(migration).toContain("resource_plan_entries");
    expect(migration).toContain("project_anomalies");
    expect(migration).toContain("refresh_project_anomalies");
    expect(read("supabase/migrations/20260817251000_100_command_center_nullsafe.sql")).toContain("generate_series(0,12)");
    expect(controlPage).toContain("CommandCenterPanel");
    expect(controlPage).toContain("ReconciliationPanel");
    expect(controlPage).toContain("ExecutionPanel");
    expect(controlPage).toContain("Suspense");
    expect(isolatedPanels).toContain("ProjectCommandCenter");
    expect(isolatedPanels).toContain("ProjectReconciliationGraph");
    expect(isolatedPanels).toContain("PanelFailure");
  });

  it("activates the previously missing company search route", () => {
    expect(read("components/layout/company-shell.tsx")).toContain("/search");
    expect(read("app/workspace/companies/[workspaceId]/search/page.tsx")).toContain("CompanySearch");
    expect(read("app/api/company/search/route.ts")).toContain("search_workspace_entities");
  });
});
