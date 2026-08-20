import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/ai/gemini-document.ts", "utf8");

describe("Gemini structured response schema", () => {
  it("does not send an empty enum value to GenerateContent", () => {
    expect(source).not.toContain('expenseCategory: { type: "STRING", enum: [""');
    expect(source).toContain('expenseCategory: { type: "STRING" }');
  });

  it("still allows the normalized application model to represent unknown categories as empty", () => {
    expect(source).toContain('expenseCategory: String(line.expenseCategory ?? "")');
  });
});
