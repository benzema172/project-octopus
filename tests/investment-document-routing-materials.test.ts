import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("material routing", () => {
  it("maps PVC and sanitary evidence to sanitary context and system metadata", () => {
    expect(routing).toMatch(/pvc[\s\S]*sanitarna/);
    expect(routing).toContain("installation");
    expect(routing).toContain("systemCode");
    expect(routing).toContain("inferredDiscipline");
  });
});
