import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(path:string)=>readFileSync(path,"utf8");
const migration=read("supabase/migrations/20261030152000_fuel_purchase_vehicle_assignment.sql");
const api=read("app/api/company/fuel-purchase-inbox/route.ts");
const ui=read("components/documents/fuel-purchase-inbox.tsx");
const upload=read("components/documents/document-upload.tsx");
const fleet=read("components/company/fleet-workspace-300.tsx");

describe("Wrzutnia fuel purchase vehicle assignment",()=>{
  it("captures only fuel lines on purchase invoices and excludes vehicle fluids",()=>{
    expect(migration).toContain("private.is_motor_fuel_line_20261030");
    expect(migration).toContain("new.expense_category,new.business_metadata");
    expect(migration).toContain("v_invoice.direction <> 'purchase'");
    expect(migration).toContain("adblue|mocznik|olej silnikowy");
    expect(migration).toContain("benzyn[ay]|pb");
    expect(migration).toContain("invoice_line_fuel_purchase_review_20261030");
  });
  it("keeps each fuel purchase idempotent, with no automatic posting",()=>{
    expect(migration).toContain("invoice_line_id uuid not null unique");
    expect(migration).toContain("fuel_entries_one_invoice_line_tanking_20261030");
    expect(migration).toContain("for update");
    expect(migration).toContain("r.status='assigned'");
    expect(migration).toContain("duplicate_invoice.counterparty_id is not distinct from i.counterparty_id");
    expect(migration).toContain("if exists(select 1 from public.fleet_cost_links");
    expect(migration).not.toContain("insert into public.invoices");
    expect(migration).not.toContain("insert into public.stock_movements");
  });
  it("guards the RPC and all company-scoped reads behind fleet permissions",()=>{
    expect(migration).toContain("alter table public.fuel_purchase_reviews enable row level security");
    expect(migration).toContain("revoke all on function public.resolve_fuel_purchase_review_20261030");
    expect(api).toContain('domain: "fleet", level');
    expect(api).toContain('.eq("workspace_id",workspaceId)');
    expect(api).toContain('authorize(request,input.workspaceId,"write")');
    expect(api).toContain('rpc("resolve_fuel_purchase_review_20261030"');
  });
  it("exposes the same compact queue in Wrzutnia and fleet waiting",()=>{
    expect(upload).toContain("<FuelPurchaseInbox");
    expect(fleet).toContain("<FuelPurchaseInbox");
    expect(ui).toContain('name="vehicleId"');
    expect(ui).toContain('name="liters"');
    expect(ui).toContain('name="amount"');
    expect(ui).toContain('void update("assign",item.id,event)');
    expect(ui).toContain('void update("ignore",item.id)');
  });
});
