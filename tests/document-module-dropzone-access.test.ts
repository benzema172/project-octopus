import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("module dropzone routing and access", () => {
  const page = read("app/workspace/companies/[workspaceId]/documents/page.tsx");
  const link = read("components/documents/module-dropzone-link.tsx");
  const uploadRoute = read("app/api/storage/upload-url/route.ts");
  const uploadUi = read("components/documents/document-upload.tsx");
  const importSessionRoute = read("app/api/documents/import-session/route.ts");

  it("keeps module context in the dropzone URL", () => {
    expect(link).toContain("sourceModule=${sourceModule}");
    expect(page).toContain("normalizeDocumentSourceModule(query.sourceModule)");
  });

  it("authorizes a module dropzone with its own domain instead of requiring Investments", () => {
    expect(page).toContain('if (sourceModule === "warehouse") return "warehouse"');
    expect(page).toContain('if (sourceModule === "finance") return "finance"');
    expect(page).toContain('if (sourceModule === "hr") return "hr"');
    expect(page).toContain('if (sourceModule === "fleet") return "fleet"');
    expect(page).toContain("domain: pageDomain");
  });

  it("preserves source-module routing for the upload intent", () => {
    expect(page).toContain("sourceModule={sourceModule ?? undefined}");
    expect(uploadUi).toContain("sourceModule?: DocumentSourceModule");
    expect(uploadUi).toContain("sourceModule: sourceModule ?? undefined,");
    expect(importSessionRoute).toContain("const sourceModule = normalizeDocumentSourceModule(body.sourceModule);");
    expect(uploadRoute).toContain("normalizeDocumentSourceModule(body.sourceModule) ?? sourceModuleFromReferer(request)");
    expect(uploadRoute).toContain("sourceMetadata: sourceModule ? sourceModuleMetadata(sourceModule) : undefined");
  });
});
