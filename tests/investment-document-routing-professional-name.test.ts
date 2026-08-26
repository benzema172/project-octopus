import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("professional document naming", () => {
  it("asks AI for a short semantic name instead of keeping only the source filename", () => {
    expect(routing).toContain("Nadaj krótka, profesjonalną nazwę dokumentu");
    expect(routing).toContain("Nazwa ma opisywać treść, a nie nazwę pliku");
  });
});
