import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("web routing sources", () => {
  it("stores source title and URI when Google Search grounding is available", () => {
    expect(routing).toContain("groundingChunks");
    expect(routing).toContain("title: compact(chunk.web?.title)");
    expect(routing).toContain("uri: compact(chunk.web?.uri)");
  });
});
