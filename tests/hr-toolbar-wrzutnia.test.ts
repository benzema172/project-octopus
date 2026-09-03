import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR toolbar Wrzutnia", () => {
  it("uses the same primary dropzone action as Warehouse and removes CSV export from the toolbar", () => {
    const page = read("app/workspace/companies/[workspaceId]/hr/page.tsx");
    const workspace = read("components/company/hr/hr-workspace-core-300.tsx");

    expect(page).not.toContain("ModuleDropzoneLink");
    expect(workspace).toContain('sourceModule="hr" variant="primary"');
    expect(workspace).not.toContain("Raport CSV");
    expect(workspace).not.toContain("/api/company/hr/export");
  });

  it("ends the tabs panel before the standalone Wrzutnia action", () => {
    const workspace = read("components/company/hr/hr-workspace-core-300.tsx");
    const styles = read("components/company/hr/hr-workspace-149.module.css");

    expect(workspace).toContain('data-hr-toolbar="split"');
    expect(workspace).toContain('data-hr-tabs="panel"');
    expect(workspace).toContain('data-hr-toolbar-actions="1"');
    expect(styles).toContain('[data-hr-toolbar="split"]');
    expect(styles).toContain('[data-hr-tabs="panel"]');
    expect(styles).toContain('[data-hr-toolbar-actions="1"]>[data-module-dropzone="hr"]');
    expect(styles).toContain("border:0!important");
    expect(styles).toContain("border:1px solid #dde2ea");
  });

  it("does not stretch the HR dropzone beyond the shared Warehouse primary-button height", () => {
    const styles = read("components/company/hr/hr-workspace-149.module.css");
    const globals = read("app/globals.css");

    expect(styles).toContain('align-self:center');
    expect(styles).toContain('min-height:42px');
    expect(styles).not.toContain('min-height:100%');
    expect(globals).toContain('.primary-button,');
    expect(globals).toContain('min-height: 42px;');
  });
});
