import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("project primary actions", () => {
  it("gives every operation form a stable mode-specific anchor", () => {
    const operationForm = read("components/projects/project-operation-form.tsx");
    expect(operationForm).toContain('id={`operation-${mode}`}');
    expect(operationForm).toContain("scrollMarginTop: 16");
  });
});
