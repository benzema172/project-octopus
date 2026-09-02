import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeDocumentSourceModule,
  preferredCategoryForSourceModule,
  sourceModuleMetadata,
  sourceModulePromptHint
} from "../lib/documents/source-module";

const read = (path: string) => readFileSync(path, "utf8");

describe("module-aware Wrzutnia", () => {
  it("maps only supported source modules to routing hints", () => {
    expect(normalizeDocumentSourceModule("warehouse")).toBe("warehouse");
    expect(normalizeDocumentSourceModule("HR")).toBe("hr");
    expect(normalizeDocumentSourceModule("finances")).toBeNull();
    expect(preferredCategoryForSourceModule("warehouse")).toBe("warehouse");
    expect(preferredCategoryForSourceModule("hr")).toBe("hr");
  });

  it("stores a strong hint without turning it into a hard category lock", () => {
    expect(sourceModuleMetadata("warehouse")).toEqual({
      sourceModule: "warehouse",
      routingHint: "strong",
      preferredCategory: "warehouse"
    });
    expect(sourceModulePromptHint("warehouse")).toContain("silną podpowiedź routingu");
    expect(sourceModulePromptHint("warehouse")).toContain("nie twardą blokadę");
    expect(sourceModulePromptHint("hr")).toContain('category="hr"');
  });

  it("uses the same primary Wrzutnia action pattern in Warehouse and HR", () => {
    const operationalPage = read("components/company/company-operational-page.tsx");
    const moduleShell = read("components/company/operations/module-shell.tsx");
    const hrPage = read("app/workspace/companies/[workspaceId]/hr/page.tsx");
    const hrCore = read("components/company/hr/hr-workspace-core-300.tsx");
    const link = read("components/documents/module-dropzone-link.tsx");
    const styles = read("components/documents/module-dropzone-link.module.css");

    expect(operationalPage).not.toContain("ModuleDropzoneLink");
    expect(moduleShell).toContain('const isWarehouse = pathname.endsWith("/warehouse")');
    expect(moduleShell).toContain('<ModuleDropzoneLink workspaceId={workspaceId} sourceModule="warehouse" variant="primary" />');
    expect(hrPage).not.toContain("ModuleDropzoneLink");
    expect(hrCore).toContain('<ModuleDropzoneLink workspaceId={props.workspaceId} sourceModule="hr" variant="primary" />');
    expect(hrCore).not.toContain("Raport CSV");
    expect(link).toContain("?upload=1&sourceModule=${sourceModule}#wrzutnia");
    expect(link).toContain('variant === "primary" ? `primary-button ${styles.primary}`');
    expect(styles).toContain('[data-warehouse-experience="2.0"] a[href*="/documents"]');
    expect(styles).toContain('[data-hr-core="300"] [data-hr-functional-upload="1"]');
  });

  it("persists source context and lets AI override the hinted category", () => {
    const prepare = read("app/api/storage/upload-url/route.ts");
    const complete = read("app/api/storage/complete/route.ts");
    const processor = read("lib/ai/process-document.ts");

    expect(prepare).toContain("sourceModuleFromReferer");
    expect(prepare).toContain("sourcePreferredCategory");
    expect(prepare).toContain("sourceModuleMetadata(sourceModule)");
    expect(prepare).toContain("const categoryLocked = Boolean(requestedDocumentId || (body.categoryLocked && requestedCategory))");

    expect(complete).toContain("requested_category: routingCategory");
    expect(complete).toContain("source_metadata: sourceMetadata");
    expect(complete).toContain("created_by: user.id");
    expect(complete).not.toContain("received_at");

    expect(processor).toContain("sourceModulePromptHint(sourceModule)");
    expect(processor).toContain("source_module_hint_applied: Boolean(sourceRoutingHint)");
    expect(processor).toContain("const effectiveCategory = lockedCategory ?? analysis.category");
  });
});
