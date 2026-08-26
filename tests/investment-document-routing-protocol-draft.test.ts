import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("protocol requirement inference", () => {
  it("creates protocol requirements as proposals with source evidence", () => {
    expect(routing).toContain("proposal_type: \"protocol_requirement\"");
    expect(routing).toContain("requires_formal_approval: true");
    expect(routing).toContain("source_quote: item.evidence");
    expect(routing).toContain("inferredFromKnowledge: true");
  });
});
