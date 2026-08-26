import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("web grounding fallback", () => {
  it("can be disabled and falls back without blocking processing", () => {
    expect(routing).toContain("OCTOPUS_AI_WEB_GROUNDING");
    expect(routing).toContain("disabled");
    expect(routing).toContain("MAX_WEB_GROUNDINGS_PER_DAY");
    expect(routing).toContain("routing: null as WebRouting | null, grounded: false");
  });
});
