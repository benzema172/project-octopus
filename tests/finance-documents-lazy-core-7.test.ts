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

  it("navigates to Documents only when its server data is missing", () => {
    const tower = source("components/company/finance-control-tower.tsx");
    expect(tower).toContain('const sourceLayerLoaded = url.searchParams.get("tab") === "documents"');
    expect(tower).toContain('if (nextTab === "documents" && !sourceLayerLoaded)');
    expect(tower).toContain('url.searchParams.set("tab", "documents")');
    expect(tower).toContain("router.replace(");
  });

  it("keeps already loaded Documents data in the current tree when switching tabs", () => {
    const tower = source("components/company/finance-control-tower.tsx");
    expect(tower).toContain('if (nextTab !== "documents" && sourceLayerLoaded)');
    expect(tower).toContain('url.searchParams.delete("tab")');
    expect(tower).toContain("window.history.replaceState");
    expect(tower).toContain("onClick={() => selectTab(id)}");
  });
});
