import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR toolbar Wrzutnia", () => {
  it("uses the same primary dropzone action as Warehouse and removes CSV export from the toolbar", () => {
    const page = read("app/workspace/companies/[workspaceId]/hr/page.tsx");
    const workspace = read("components/company/hr/hr-workspace-core-300.tsx");
    const warehouse = read("components/company/warehouse-workspace-300.tsx");

    expect(page).not.toContain("ModuleDropzoneLink");
    expect(workspace).toContain('sourceModule="hr" variant="primary"');
    expect(warehouse).toContain('sourceModule="warehouse" variant="primary"');
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

  it("uses one exact shared 184x42 primary box in HR and Warehouse", () => {
    const hrStyles = read("components/company/hr/hr-workspace-149.module.css");
    const dropzoneStyles = read("components/documents/module-dropzone-link.module.css");

    expect(hrStyles).toContain("align-self:center");
    expect(hrStyles).not.toContain("min-height:42px");
    expect(hrStyles).not.toContain("min-height:100%");

    expect(dropzoneStyles).toContain("width: 184px;");
    expect(dropzoneStyles).toContain("min-width: 184px;");
    expect(dropzoneStyles).toContain("max-width: 184px;");
    expect(dropzoneStyles).toContain("height: 42px;");
    expect(dropzoneStyles).toContain("min-height: 42px;");
    expect(dropzoneStyles).toContain("max-height: 42px;");
    expect(dropzoneStyles).toContain("padding: 0 15px;");
  });
});
