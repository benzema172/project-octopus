import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/brain/process/route.ts", "utf8");

describe("brain/process version lookup", () => {
  it("resolves the version and workspace document without an embedded PostgREST join", () => {
    expect(route).toMatch(/\.from\("document_versions"\)/);
    expect(route).toMatch(/\.select\("document_id,project_id"\)/);
    expect(route).toMatch(/versionError/);

    expect(route).toMatch(/\.from\("documents"\)/);
    expect(route).toMatch(/\.eq\("id", version\.document_id\)/);
    expect(route).toMatch(/\.eq\("workspace_id", workspace\.id\)/);
    expect(route).toMatch(/documentError/);

    expect(route).not.toMatch(/documents!inner\(workspace_id,category\)/);
  });

  it("distinguishes database failures from a genuine missing version", () => {
    expect(route).toMatch(/\[brain\/process\] version lookup failed/);
    expect(route).toMatch(/Nie udało się odczytać wersji dokumentu\./);
    expect(route).toMatch(/Nie znaleziono wersji dokumentu\./);
    expect(route).toMatch(/\[brain\/process\] document lookup failed/);
  });
});
