import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectUploadKind, isMimeCompatibleWithKind } from "@/lib/uploads/file-signatures";
import { scoreTextCandidate } from "@/lib/investments/semantic-candidate-score";

const read = (path: string) => readFileSync(path, "utf8");

describe("0.9.1–1.0 implementation contracts", () => {
  it("accepts a real PDF signature and rejects a renamed executable", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(detectUploadKind(pdf)).toBe("pdf");
    expect(isMimeCompatibleWithKind("application/pdf", "pdf")).toBe(true);
    expect(detectUploadKind(exe)).toBe("unknown");
    expect(isMimeCompatibleWithKind("application/pdf", "unknown")).toBe(false);
  });

  it("recognizes OpenXML/ZIP and blocks binary text", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const binary = new Uint8Array([0x00, 0xff, 0x00, 0xff, 0x00, 0xff]);
    expect(detectUploadKind(zip)).toBe("zip");
    expect(detectUploadKind(binary)).toBe("unknown");
  });

  it("prefers matching technical description and diameter", () => {
    const exact = scoreTextCandidate("Rura PPR PN20 fi 32", "Rura PPR PN20 32 mm instalacja wody");
    const weak = scoreTextCandidate("Rura PPR PN20 fi 32", "Rura stalowa DN100 instalacja gazowa");
    expect(exact).toBeGreaterThan(weak);
    expect(exact).toBeGreaterThan(0.4);
  });

  it("keeps unrelated candidates low", () => {
    expect(scoreTextCandidate("Centrala wentylacyjna 2500 m3/h", "Zawór kulowy DN15 CWU")).toBeLessThan(0.25);
  });

  it("routes critical writes through atomic RPCs", () => {
    const projectRoute = read("app/api/projects/records/route.ts");
    const companyRoute = read("app/api/company/records/route.ts");
    expect(projectRoute).toContain("approve_estimate_import_atomic");
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
    const migration = read("supabase/migrations/20260817240000_095_ai_quality.sql");
    expect(migration).toContain("ai_quality_events");
    expect(migration).toContain("ai_review_actions");
    expect(migration).toContain("get_ai_quality_metrics");
  });

  it("provides 1.0 cash flow, resources, correspondence and isolated Control 360 panels", () => {
    const migration = read("supabase/migrations/20260817250000_100_command_center.sql");
    const control = read("components/projects/control-isolated-panels.tsx");
    expect(migration).toContain("cashflow13w");
    expect(migration).toContain("resource_plan_entries");
    expect(migration).toContain("correspondence_items");
    expect(control).toContain("CommandCenterPanel");
    expect(control).toContain("AutopilotPanel");
    expect(control).toContain("ReconciliationPanel");
    expect(control).toContain("ExecutionPanel");
  });

  it("activates the previously missing company search route", () => {
    expect(read("app/workspace/companies/[workspaceId]/search/page.tsx")).toContain("CompanySearchPage");
  });
});
