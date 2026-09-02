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
});
