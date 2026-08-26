import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("inferred protocol boundary", () => {
  it("labels inferred requirements and requires real human result", () => {
    expect(routing).toContain("inferredFromKnowledge: true");
    expect(routing).toContain("requiresHumanResult: true");
  });
});
