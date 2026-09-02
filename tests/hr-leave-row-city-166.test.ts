import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("HR leave employee row interaction", () => {
  it("treats a click anywhere on a non-interactive employee row as the existing expand action", () => {
    const workspace = source("components/company/hr/hr-workspace-149.tsx");
    const css = source("components/company/hr/hr-workspace-149.module.css");

    expect(workspace).toContain('section[data-hr-leaves-165="1"] tbody tr');
    expect(workspace).toContain('button[aria-expanded]');
    expect(workspace).toContain("rowToggle.click()");
    expect(workspace).toContain('target.closest("button,a,input,select,textarea,label")');
    expect(css).toContain('section[data-hr-leaves-165="1"] tbody tr:has(button[aria-expanded])');
    expect(css).toContain("cursor:pointer");
  });
});

describe("HR leave request company locality", () => {
  it("takes the locality from the company general profile and keeps generated previews synchronized without DOM observers", () => {
    const page = source("app/workspace/companies/[workspaceId]/hr/page.tsx");
    const workspace = source("components/company/hr/hr-workspace-149.tsx");

    expect(page).toContain("companyCity={workspace.city}");
    expect(workspace).toContain("const city = String(companyCity ?? \"\").trim()");
    expect(workspace).toContain("scheduleCityPreviewSync(rootRef.current, city)");
    expect(workspace).toContain("window.requestAnimationFrame(sync)");
    expect(workspace).toContain("[50, 150, 350]");
    expect(workspace).not.toContain("MutationObserver");
    expect(workspace).toContain('const locationDate = `${city}, ${new Date().toLocaleDateString("pl-PL")}`');
    expect(workspace).toContain("line.textContent !== locationDate");
    expect(workspace).toContain("patchDocumentGenerators(city)");
  });
});
