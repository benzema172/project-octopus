import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Performance Core 9-13", () => {
  it("runs finance Multi-AI only when a pending review exists", () => {
    const migration = read("supabase/migrations/20260921111500_performance_core_9_13.sql");
    const worker = read("app/api/company/unified-document-ai/worker/route.ts");

    expect(migration).toContain("get_pending_finance_multi_ai_reviews");
    expect(migration).toContain("run_unified_document_ai_queue_tick");
    expect(migration).toContain("select public.run_unified_document_ai_queue_tick();");
    expect(worker).toContain('db.rpc("get_pending_finance_multi_ai_reviews"');
    expect(worker).not.toContain('db.from("ai_consensus_events")');
  });

  it("does not load retired Fleet screens on every Fleet request", () => {
    const loader = read("lib/data/fleet-core-300.ts");

    for (const retiredTable of [
      "fleet_document_reviews",
      "fleet_anomalies",
      "service_orders",
      "damage_cases",
      "vehicle_service_plans",
      "vehicle_checks",
      "fleet_ai_decision_events",
      "fleet_ai_feedback"
    ]) {
      expect(loader).not.toContain(`.from("${retiredTable}")`);
    }
  });

  it("does not eagerly load unused legacy Warehouse Market datasets", () => {
    const loader = read("lib/data/warehouse-market-400.ts");

    for (const retiredTable of [
      "stock_lots",
      "warehouse_logistic_units",
      "warehouse_logistic_unit_items",
      "warehouse_tasks",
      "warehouse_crossdock_links",
      "warehouse_supplier_scores",
      "warehouse_returns",
      "warehouse_return_lines",
      "warehouse_integrations",
      "warehouse_device_events",
      "warehouse_shipments"
    ]) {
      expect(loader).not.toContain(`.from("${retiredTable}")`);
    }
  });

  it("mounts Warehouse and Fleet secondary views only when selected", () => {
    const warehouse = read("components/company/operations/warehouse-operations.tsx");
    const fleet = read("components/company/operations/fleet-operations.tsx");

    expect(warehouse).toContain('activeTab === "movements"');
    expect(warehouse).toContain('activeTab === "prices"');
    expect(warehouse).toContain('activeTab === "dashboard"');
    expect(fleet).toContain('activeTab === "equipment"');
    expect(fleet).toContain('activeTab === "costs"');
  });

  it("keeps document full-text search indexable", () => {
    const migration = read("supabase/migrations/20260921111500_performance_core_9_13.sql");
    expect(migration).toContain("document_texts_search_vector_perf13_idx");
    expect(migration).toContain("to_tsvector('simple'::regconfig, coalesce(extracted_text, ''))");
  });
});
