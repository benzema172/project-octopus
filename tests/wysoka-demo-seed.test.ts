import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const seed = [
  "wysoka-seed-shared.ts", "wysoka-seed-project.ts", "wysoka-seed-project-foundation.ts", "wysoka-seed-project-control.ts", "wysoka-seed-documents.ts",
  "wysoka-seed-finance.ts", "wysoka-seed-hr.ts", "wysoka-seed-warehouse.ts", "wysoka-seed-fleet.ts", "wysoka-seed-reports.ts", "wysoka-test-data.ts"
].map((file) => readFileSync(`lib/demo/${file}`, "utf8")).join("\n");
const route = readFileSync("app/api/demo/wysoka-seed/route.ts", "utf8");
const bootstrap = readFileSync("components/demo/wysoka-demo-bootstrap.tsx", "utf8");
const layout = readFileSync("app/workspace/layout.tsx", "utf8");

describe("Wysoka full test dataset", () => {
  it("only seeds the existing Wysoka project and is protected by an audit marker", () => {
    expect(route).toContain('normalize(project.name) === "wysoka"');
    expect(route).toContain("profile.shortName");
    expect(route).toContain("profile.projectName");
    expect(route).toContain('["owner", "admin"]');
    expect(route).toContain("maxDuration = 300");
    expect(seed).toContain('SEED_EVENT = "demo.wysoka.seeded.v1"');
    expect(seed).toContain('event_type: SEED_EVENT');
    expect(seed).not.toContain('.insert({ name: "Wysoka"');
  });

  it("covers project execution, documents, finance, HR, warehouse, fleet and reports", () => {
    for (const table of [
      "wbs_nodes", "boq_items", "schedule_activities", "progress_entries", "protocols", "protocol_requirements",
      "material_requests", "evidence_requirements", "site_events", "change_orders", "document_change_impacts", "forecast_snapshots",
      "project_correspondence", "resource_plan_entries", "ai_findings", "knowledge_entries", "documents",
      "invoices", "payments", "commitments", "financial_allocations", "employees", "employments", "leave_balances", "leave_requests", "timesheets",
      "warehouses", "stock_items", "stock_movements", "reservations", "inventory_counts", "tool_service_events", "vehicles", "fuel_entries", "trips", "vehicle_allocations", "service_orders",
      "damage_cases", "report_definitions", "report_runs", "report_snapshots"
    ]) expect(seed).toContain(`"${table}"`);
  });

  it("stores real demo documents in R2 and prevents automatic AI spend for them", () => {
    expect(seed).toContain("new PutObjectCommand");
    expect(seed).toContain('.rpc("complete_document_upload"');
    expect(seed).toContain('stage: "complete", status: "succeeded"');
    expect(seed).toContain("[TEST] Faktura zakupowa");
    expect(seed).toContain("[TEST] PZ-TEST-001");
  });

  it("auto-bootstraps idempotently from the authenticated workspace", () => {
    expect(layout).toContain("WysokaDemoBootstrap");
    expect(bootstrap).toContain('fetch("/api/demo/wysoka-seed"');
    expect(bootstrap).toContain("sessionStorage");
    expect(bootstrap).toContain("localStorage");
    expect(bootstrap).toContain("router.refresh()");
  });
});
