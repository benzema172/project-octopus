import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("PVC sanitary routing example", () => {
  it("contains deterministic PVC sanitary and sewer tightness inference", () => {
    expect(routing).toContain("rura pvc");
    expect(routing).toContain("Rura/element PVC + sanitarny kontekst inwestycji");
    expect(routing).toContain("proba_szczelnosci_kanalizacji");
  });
});
