import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("web knowledge boundary", () => {
  it("uses the web only for auxiliary construction knowledge, not project facts", () => {
    expect(routing).toContain("Użyj Google Search WYŁĄCZNIE jako pomocniczej wiedzy branżowej");
    expect(routing).toContain("Nie zastępuj internetem danych konkretnej budowy");
  });
});
