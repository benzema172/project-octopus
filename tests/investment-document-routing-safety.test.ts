import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");
const autopilot = readFileSync("lib/ai/document-autopilot.ts", "utf8");

describe("investment document routing safety", () => {
  it("infers requirements but never fabricates completed test results", () => {
    expect(routing).toContain("requiresHumanResult: true");
    expect(routing).toContain("wynik rzeczywistej próby");
    expect(routing).not.toContain("result: \"passed\"");
    expect(routing).not.toContain("result: \"positive\"");
    expect(autopilot).toContain("Wynik, pomiary i podpisy pozostają puste do czasu faktycznego wykonania czynności.");
  });

  it("does not make web grounding a hard dependency", () => {
    expect(routing).toMatch(/if \(!response\.ok\) return \{ routing: null/);
    expect(routing).toMatch(/catch \{[\s\S]*routing: null/);
    expect(routing).toContain("inferConstructionProtocols");
  });
});
