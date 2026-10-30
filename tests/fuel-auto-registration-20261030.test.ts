import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");
const sql=read("supabase/migrations/20261030163000_auto_assign_fuel_by_registration.sql");
const financial=read("lib/finance/document-invoice-finalization.ts");
const analysis=read("lib/ai/process-document.ts");
const warehouseAI=read("lib/ai/gemini-warehouse-document.ts");
const generalAI=read("lib/ai/gemini-document.ts");
const api=read("app/api/company/fuel-purchase-inbox/route.ts");
const ui=read("components/documents/fuel-purchase-inbox.tsx");

describe("Automatic fuel plate assignment",()=>{
  it("checks a unique exact plate in a single workspace; never trusts prefilled vehicle_id",()=>{
    expect(sql).toContain("private.normalize_fuel_plate_20261030");
    expect(sql).toContain("regexp_replace(upper");
    expect(sql).toContain("business_metadata->>'vehicleRegistration'");
    expect(sql).toContain("v_match_count <> 1");
    expect(sql).toContain("v.status<>'sold'");
    expect(sql).toContain("v.workspace_id=p_workspace_id");
    expect(sql).not.toContain("vehicle_id = r.vehicle_id");
  });
  it("requires fuel liters and a valid gross amount before booking",()=>{
    expect(sql).toContain("private.is_motor_fuel_line_20261030");
    expect(sql).toContain("r.gross_amount<=0");
    expect(sql).toContain("v_liters is null");
    expect(sql).toContain("public.resolve_fuel_purchase_review_20261030(");
    expect(sql).toContain("status='pending'");
    expect(sql).toContain("assignment_mode='automatic'");
    expect(sql).toContain("Wymagana ręczna kontrola zgodności tankowania");
  });
  it("does not turn fiscal receipts into VAT invoices",()=>{
    expect(warehouseAI).toContain('"receipt"');
    expect(warehouseAI).toContain('document.documentType === "receipt"');
    expect(warehouseAI).toContain('return "fleet"');
    expect(generalAI).toContain("paragonu fiskalnego");
    expect(analysis).toContain("auto_assign_fuel_receipt_by_registration_20261030");
    expect(sql).toContain("not_single_receipt");
    expect(sql).toContain("already_booked");
    expect(sql).toContain("fuel_entries_one_auto_receipt_20261030");
    expect(sql).toContain("v_match_count<>1");
    expect(sql).toContain("f.vehicle_id=v_vehicle_id");
    expect(sql).not.toContain("insert into public.invoices");
  });
  it("runs after canonical financial approval and shows activity",()=>{
    expect(financial).toContain("auto_assign_fuel_by_registration_20261030");
    expect(financial.indexOf("runAccountingCopilotForDocument")).toBeLessThan(financial.lastIndexOf("auto_assign_fuel_by_registration_20261030"));
    expect(api).toContain("recentAutomatic");
    expect(api).toContain('.eq("workspace_id",workspaceId)');
    expect(ui).toContain("AI przypisało automatycznie");
    expect(ui).toContain("Wybierz z Floty");
  });
});
