import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");
const archive=read("components/documents/document-central-archive.tsx");
const page=read("app/workspace/companies/[workspaceId]/documents/page.tsx");
const upload=read("components/documents/document-upload.tsx");
const fuel=read("components/documents/fuel-purchase-inbox.tsx");
const api=read("app/api/company/fuel-purchase-inbox/route.ts");

describe("Tankowania are a dedicated Documents archive tab",()=>{
  it("adds the new navigation pill between Flota and Wzory i Brain",()=>{
    expect(archive).toMatch(/\{ id: "fleet", label: "Flota" \},\s*\{ id: "fuel", label: "Tankowania" \},\s*\{ id: "templates", label: "Wzory i Brain" \}/);
    expect(archive).toContain('tab === "fuel" ? (');
    expect(archive).toContain("<FuelPurchaseInbox");
    expect(archive).toContain('onPendingCountChange={setPendingFuelCount}');
    expect(archive).toContain('role="tabpanel"');
    expect(page).toContain('"fleet", "fuel", "templates"');
    expect(page).toContain('activeTab === "trash" || activeTab === "fuel"');
  });
  it("does not render the fuel queue beneath the global Wrzutnia anymore",()=>{
    expect(upload).not.toContain("FuelPurchaseInbox");
    expect(page).toContain('displayMode="intake"');
    expect(archive).toContain('tab === "all" ? <div className={styles.uploadHome}');
  });
  it("scopes the tab to Fleet-read authorized users and never exposes other companies",()=>{
    expect(page).toContain('const canReadFuel = domainAccessPolicyAllows(accessPolicy, {domain:"fleet",level:"read",projectId:null})');
    expect(archive).toContain('item.id!=="fuel" || canReadFuel');
    expect(api).toContain('authorize(request, workspaceId, "read")');
    expect(api).toContain('.eq("workspace_id",workspaceId).eq("status","pending")');
    expect(page).toContain('activeTab !== "fuel"');
  });
  it("counts all pending tankowania with light server-side count endpoint",()=>{
    expect(archive).toContain('countOnly=1');
    expect(archive).toContain('pendingFuelCount ?? "…"');
    expect(api).toContain('select("id",{count:"exact",head:true})');
    expect(api).toContain('return NextResponse.json({pendingCount:count??0}');
    expect(fuel).toContain('onPendingCountChange?.(body.pendingCount');
    expect(fuel).toContain('await refresh()');
  });
  it("retains existing vehicle assignment actions, monetary values and recent AI history",()=>{
    expect(fuel).toContain('update("assign",item.id,event)');
    expect(fuel).toContain('update("ignore",item.id)');
    expect(fuel).toContain('recentAutomatic.length');
    expect(api).toContain('resolve_fuel_purchase_review_20261030');
  });
});
