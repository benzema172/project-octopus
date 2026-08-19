import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");

describe("Flow Integrity 1.1 — P0/P1 contracts",()=>{
  it("separates project inventory overhead and unassigned financial truth",()=>{
    const schema=read("supabase/migrations/20260819050000_117_flow_integrity_schema.sql");
    const finance=read("supabase/migrations/20260819053000_120_flow_integrity_accounting_costs.sql");
    expect(schema).toContain("allocation_scope in ('project','overhead','unassigned','inventory')");
    expect(finance).toContain("allocation_scope='project'");
    expect(finance).toContain("inventoryIssuedCost");
    expect(finance).toContain("310-01");
  });

  it("uses one hard procurement trace from WM through PO PZ and invoice",()=>{
    const procurement=read("supabase/migrations/20260819051000_118_flow_integrity_procurement.sql");
    const matching=read("supabase/migrations/20260819052000_119_flow_integrity_matching_inventory.sql");
    expect(procurement).toContain("ensure_procurement_trace_atomic");
    expect(procurement).toContain("create_purchase_order_v2_atomic");
    expect(procurement).toContain("Kartoteka zamówienia różni się od materiału zatwierdzonego w WM");
    expect(matching).toContain("v_line.procurement_trace_id");
    expect(matching).toContain("v_candidate_count=1");
  });

  it("reduces purchase commitments after matched invoices",()=>{
    const procurement=read("supabase/migrations/20260819051000_118_flow_integrity_procurement.sql");
    expect(procurement).toContain("sync_purchase_order_commitment_atomic");
    expect(procurement).toContain("original_amount");
    expect(procurement).toContain("recognized_amount");
    expect(procurement).toContain("v_original-v_recognized");
  });

  it("recognizes central warehouse cost on issue without double counting direct purchases",()=>{
    const inventory=read("supabase/migrations/20260819050500_117_inventory_cost_layers.sql");
    const matching=read("supabase/migrations/20260819052000_119_flow_integrity_matching_inventory.sql");
    expect(inventory).toContain("inventory_cost_layers");
    expect(inventory).toContain("recognize_project_cost");
    expect(matching).toContain("consume_inventory_for_issue_atomic");
    expect(matching).toContain("recognition_mode in ('central_stock','unassigned')");
  });

  it("reprocesses canonical invoices safely and refuses exported accounting drift",()=>{
    const ingress=read("supabase/migrations/20260819054000_121_flow_integrity_canonical_ingress.sql");
    expect(ingress).toContain("upsert_canonical_business_document_atomic");
    expect(ingress).toContain("Reprocessing wymaga korekty/storna");
    expect(ingress).toContain("Reprocessing usunął wcześniej ręcznie uzgodnioną pozycję");
    expect(ingress).toContain("delete from public.invoice_lines where id=v_stale.id");
    expect(ingress).toContain("allocation_source='automatic'");
  });

  it("routes PDF and external systems through one canonical Business Inbox processor",()=>{
    const ingress=read("supabase/migrations/20260819054000_121_flow_integrity_canonical_ingress.sql");
    const external=read("app/api/integrations/business-inbox/route.ts");
    expect(ingress).toContain("process_business_inbox_item_atomic");
    expect(ingress).toContain("orchestrate_approved_business_document_atomic");
    expect(external).toContain('"ksef", "erp", "subiekt", "comarch", "symfonia", "enova", "email", "api"');
    expect(external).toContain('rpc("process_business_inbox_item_atomic"');
  });

  it("counts one purchase in Price Intelligence while preserving ordered received and invoiced stages",()=>{
    const matching=read("supabase/migrations/20260819052000_119_flow_integrity_matching_inventory.sql");
    expect(matching).toContain("purchase_key");
    expect(matching).toContain("when 'invoiced' then 1");
    expect(matching).toContain("orderedPrice");
    expect(matching).toContain("receivedPrice");
    expect(matching).toContain("invoicedPrice");
  });

  it("uses accounting rules and specialized fuel invoice metadata",()=>{
    const accounting=read("supabase/migrations/20260819053000_120_flow_integrity_accounting_costs.sql");
    const ingress=read("supabase/migrations/20260819054000_121_flow_integrity_canonical_ingress.sql");
    expect(accounting).toContain("resolve_accounting_rule");
    expect(accounting).toContain("Paliwo i flota");
    expect(ingress).toContain("vehicleRegistration");
    expect(ingress).toContain("fuel_entries");
    expect(ingress).toContain("invoice_line_id");
  });

  it("surfaces allocation scope and material trace controls in real UI",()=>{
    const finance=read("components/company/finance-allocation-scope-panel.tsx");
    const wm=read("components/projects/material-request-integrity-panel.tsx");
    const warehouse=read("components/company/warehouse-flow-integrity-panel.tsx");
    const reconciliation=read("components/projects/project-reconciliation-graph.tsx");
    expect(finance).toContain("Magazyn centralny");
    expect(finance).toContain("Koszt ogólny firmy");
    expect(finance).toContain("Do rozpoznania");
    expect(wm).toContain("Procurement Trace");
    expect(warehouse).toContain("stock_movement_approve");
    expect(reconciliation).toContain('name="destinationMode"');
  });

  it("keeps Control and project graph on the canonical project ledger",()=>{
    const control=read("lib/data/control-snapshot.ts");
    const consistency=read("supabase/migrations/20260819055000_122_flow_integrity_consistency_rpc.sql");
    const graph=read("supabase/migrations/20260819060000_123_flow_integrity_cost_graph.sql");
    expect(control).toContain('rpc("get_project_cost_ledger"');
    expect(consistency).toContain("get_project_command_center_consistent");
    expect(graph).toContain("public.get_project_cost_ledger");
  });
});
