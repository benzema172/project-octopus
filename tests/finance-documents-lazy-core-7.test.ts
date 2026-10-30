import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Finance Documents Lazy Core 7", () => {
  it("does not render the heavy finance source layer until Documents is requested", () => {
    const page = source("app/workspace/companies/[workspaceId]/finances/page.tsx");
    expect(page).toContain('const showSourceLayer = query.tab === "documents"');
    expect(page).toContain('{showSourceLayer ? <div className="finance-source-layer">');
    expect(page).toContain("<UnifiedDocumentFlowSection");
    expect(page).toContain("loader={getFinanceWorkspaceData}");
    expect(page).toContain("<FinanceEnterpriseFlowSection");
  });

  it("passes the requested finance tab through the server boundary", () => {
    const page = source("app/workspace/companies/[workspaceId]/finances/page.tsx");
    const section = source("components/company/finance-control-tower-section.tsx");
    expect(page).toContain("tab?: string");
    expect(page).toContain("initialTab={query.tab}");
    expect(section).toContain("initialTab?: string");
    expect(section).toContain("initialTab={initialTab}");
  });

  it("requests the Documents server layer only when it is not already active", () => {
    const tower = source("components/company/finance-control-tower.tsx");
    expect(tower).toContain('const serverLayer = url.searchParams.get("tab")');
    expect(tower).toContain('if (nextTab === "documents" || nextTab === "accounting")');
    expect(tower).toContain("if (serverLayer !== nextTab)");
    expect(tower).toContain('url.searchParams.set("tab", nextTab)');
    expect(tower).toContain("router.replace(");
  });

  it("releases the heavy Documents/Accounting server layer when switching to a lightweight tab", () => {
    const tower = source("components/company/finance-control-tower.tsx");
    expect(tower).toContain('if (serverLayer === "documents" || serverLayer === "accounting")');
    expect(tower).toContain('url.searchParams.delete("tab")');
    expect(tower).toContain('router.replace(`${url.pathname}${url.search}`, { scroll: false })');
    expect(tower).toContain("onClick={() => selectTab(id)}");
  });
});
