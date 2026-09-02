import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Warehouse 3.0 AI-first contract", () => {
  it("uses a real top tab workspace with Magazyn and Poczekalnia", () => {
    const operations = read("components/company/operations/warehouse-operations.tsx");
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    expect(operations).toContain("WarehouseWorkspace300");
    expect(operations).not.toContain("WarehouseCommandCenter");
    expect(workspace).toContain('label: "Magazyn"');
    expect(workspace).toContain('label: "Poczekalnia"');
    expect(workspace).toContain('useState<Tab>("dashboard")');
    expect(workspace).toContain('data-warehouse-experience="3.0"');
  });

  it("makes Magazyn an A-Z canonical registry with edit and price history", () => {
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    expect(workspace).toContain('localeCompare(String(b.name ?? ""), "pl"');
    expect(workspace).toContain("Kartoteki A–Z");
    expect(workspace).toContain("Nazwa kanoniczna");
    expect(workspace).toContain('act("rename_item"');
    expect(workspace).toContain("Ostatnie zakupy i ceny");
    expect(workspace).toContain("Wyuczone nazwy dostawców");
  });

  it("implements the fast exception workspace: queue, document preview and AI decisions", () => {
    const workspace = read("components/company/warehouse-workspace-300.tsx");
    const preview = read("app/api/company/warehouse-ai/preview/route.ts");
    expect(workspace).toContain("POCZEKALNIA");
    expect(workspace).toContain("SUGESTIA OCTOPUS AI");
    expect(workspace).toContain("Akceptuj AI");
    expect(workspace).toContain("Dopasuj do istniejącej");
    expect(workspace).toContain("+ Nowa kartoteka");
    expect(workspace).toContain("Poza magazynem");
    expect(workspace).toContain("Ten dokument nie dotyczy Magazynu");
    expect(preview).toContain("GetObjectCommand");
    expect(preview).toContain("warehouse_document_reviews");
    expect(preview).toContain('"Content-Disposition"');
  });

  it("creates a per-line AI resolver and keeps real stock mutation outside the resolver", () => {
    const migration = read("supabase/migrations/20260902202000_warehouse_ai_first_300.sql");
    expect(migration).toContain("create table if not exists public.warehouse_document_reviews");
    expect(migration).toContain("create table if not exists public.warehouse_ai_lines");
    expect(migration).toContain("private.warehouse_line_class");
    expect(migration).toContain("private.resolve_warehouse_document_extraction");
    expect(migration).toContain("source_metadata->>'sourceModule'");
    expect(migration).toContain("<> 'warehouse'");
    expect(migration).toContain("auto_matched");
    expect(migration).toContain("new_item_proposed");
    expect(migration).not.toContain("insert into public.stock_movements");
    expect(migration).not.toContain("update public.stock_balances");
  });

  it("learns supplier aliases and captures prices without changing inventory quantity", () => {
    const api = read("app/api/company/warehouse-ai/route.ts");
    const priceMigration = read("supabase/migrations/20260902202100_warehouse_ai_price_learning_300.sql");
    expect(api).toContain('body.action === "match"');
    expect(api).toContain('body.action === "create"');
    expect(api).toContain("material_aliases");
    expect(api).toContain('status: "approved"');
    expect(api).toContain("price_observations");
    expect(api).not.toContain("stock_movements");
    expect(priceMigration).toContain("capture_warehouse_ai_price");
    expect(priceMigration).toContain("warehouse_ai_line");
    expect(priceMigration).toContain("canonical_purchase");
    expect(priceMigration).not.toContain("stock_movements");
  });

  it("loads AI queue data together with the existing warehouse engine", () => {
    const page = read("app/workspace/companies/[workspaceId]/warehouse/page.tsx");
    const loader = read("lib/data/warehouse-ai-300.ts");
    expect(page).toContain("getWarehouseWorkspaceData");
    expect(page).toContain("getWarehouseAi300Data");
    expect(page).toContain("return { ...base, ...ai }");
    expect(loader).toContain("warehouse_document_reviews");
    expect(loader).toContain("warehouse_ai_lines");
    expect(loader).toContain("document_texts");
  });
});
