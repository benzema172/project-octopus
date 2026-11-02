import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(path:string)=>readFileSync(path,"utf8");
const fuel=read("components/documents/fuel-purchase-inbox.tsx");
const fuelApi=read("app/api/company/fuel-purchase-inbox/route.ts");
const invoiceApi=read("app/api/company/invoice-quick-preview/route.ts");
const fileApi=read("app/api/company/invoice-quick-preview/file/route.ts");
const access=read("lib/documents/fuel-invoice-preview-access.ts");

describe("Fuel invoice preview on hover in Tankowania",()=>{
  it("reuses the shared hover invoice preview and precise invoice line",()=>{
    expect(fuel).toContain('import { InvoiceQuickPreview }');
    expect(fuel).toContain('<InvoiceQuickPreview workspaceId={workspaceId} domain="fleet"');
    expect(fuel).toContain('invoiceId={item.invoiceId} invoiceLineId={item.invoiceLineId}');
    expect(fuel).toContain('{item.invoiceNumber}');
    expect(fuelApi).toContain("invoiceLineId:line.id");
  });
  it("permits only a real pending fuel review in the same workspace and same invoice",()=>{
    expect(access).toContain('.from("fuel_purchase_reviews")');
    expect(access).toContain('.eq("workspace_id", workspaceId)');
    expect(access).toContain('.eq("invoice_line_id", invoiceLineId)');
    expect(access).toContain('.eq("invoice_id", invoiceId)');
    expect(access).toContain('.eq("status", "pending")');
    for(const source of [invoiceApi,fileApi]){
      expect(source).toContain('domain === "fleet"');
      expect(source).toContain("isPendingFleetFuelInvoiceLine(");
      expect(source).toContain("getWorkspaceForUser");
      expect(source).toContain("hasDomainAccess");
      expect(source).toContain("lineMatchesDomain");
    }
    expect(fileApi).toContain('.eq("invoice_id", invoiceId)');
  });
  it("keeps the document original protected by the shared file streaming route",()=>{
    expect(fileApi).toContain("malwareScanRequiredByPolicy()");
    expect(fileApi).toContain('version.malware_scan_status === "infected"');
    expect(fileApi).toContain("inlineContentDisposition(version.file_name)");
    const preview=read("components/documents/invoice-quick-preview.tsx");
    expect(preview).toContain("onMouseEnter");
    expect(preview).toContain("onFocus");
    expect(preview).toContain("createPortal");
    expect(preview).toContain("Oryginał");
  });
});
