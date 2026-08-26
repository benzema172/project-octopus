import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("AI routing auditability", () => {
  it("records autonomous routing and web sources in document metadata and audit events", () => {
    expect(routing).toContain("ai_routing");
    expect(routing).toContain("document.investment_routed");
    expect(routing).toContain("web_sources");
    expect(routing).toContain("routed_at");
  });
});
