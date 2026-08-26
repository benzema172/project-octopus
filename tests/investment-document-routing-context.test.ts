import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routing = readFileSync("lib/ai/investment-document-routing.ts", "utf8");

describe("investment context routing", () => {
  it("uses project systems, prior documents, materials, requirements, protocols and BOQ", () => {
    for (const token of ["existingDocuments", "knownMaterials", "requirements", "existingProtocols", "boq"]) {
      expect(routing).toContain(token);
    }
  });
});
