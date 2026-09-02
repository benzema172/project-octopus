import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("HR leave employee row interaction", () => {
  it("implements whole-row expansion inside the leave component without DOM interception", () => {
    const leaves = source("components/company/hr/hr-leaves-stable-165.tsx");
    const css = source("components/company/hr/hr-leaves-stable-165.module.css");
    const workspace = source("components/company/hr/hr-workspace-149.tsx");

    expect(leaves).toContain("const handleRowClick=(event:MouseEvent<HTMLTableRowElement>)");
    expect(leaves).toContain("if(!isInteractiveTarget(event.target))toggle()");
    expect(leaves).toContain("onClick={handleRowClick}");
    expect(leaves).toContain("onKeyDown={handleRowKey}");
    expect(leaves).toContain("tabIndex={0}");
    expect(leaves).toContain('target.closest("button,a,input,select,textarea,label")');
    expect(css).toContain(".employeeRow{cursor:pointer");
    expect(css).toContain(".employeeRow:hover");
    expect(workspace).not.toContain("querySelector");
    expect(workspace).not.toContain("rowToggle.click()");
  });
});

describe("HR leave request company locality", () => {
  it("passes workspace city into the leave component and renders it natively in preview, PDF and print", () => {
    const page = source("app/workspace/companies/[workspaceId]/hr/page.tsx");
    const workspace = source("components/company/hr/hr-workspace-149.tsx");
    const core = source("components/company/hr/hr-workspace-core-300.tsx");
    const leaves = source("components/company/hr/hr-leaves-stable-165.tsx");

    expect(page).toContain("companyCity={workspace.city}");
    expect(core).toContain("companyCity?: string | null");
    expect(core).toContain("companyCity={props.companyCity}");
    expect(leaves).toContain("companyCity?: string | null");
    expect(leaves).toContain('const city=String(companyCity??"").trim()');
    expect(leaves).toContain('function locationDate(city:string)');
    expect(leaves).toContain("ctx.fillText(locationDate(city),965,160)");
    expect(leaves).toContain("${escapeHtml(locationDate(city))}");
    expect(leaves).toContain("requestHtml(previewLeave");
    expect(leaves).toContain("data.year,city)");
    expect(workspace).not.toContain("MutationObserver");
    expect(workspace).not.toContain("requestAnimationFrame");
    expect(workspace).not.toContain("patchDocumentGenerators");
  });
});
