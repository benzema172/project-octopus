import { describe, expect, it } from "vitest";
import { parseLocalizedNumber } from "../lib/numbers/parse-localized-number";

describe("parseLocalizedNumber", () => {
  it("parses Polish money values without losing thousands", () => {
    expect(parseLocalizedNumber("1 234 567,89 PLN")).toBe(1234567.89);
    expect(parseLocalizedNumber("1.234,56")).toBe(1234.56);
  });

  it("also accepts API numbers and international notation", () => {
    expect(parseLocalizedNumber("1,234.56")).toBe(1234.56);
    expect(parseLocalizedNumber(981.25)).toBe(981.25);
    expect(parseLocalizedNumber("(2 500,00 PLN)")).toBe(-2500);
  });

  it("returns the supplied fallback for invalid values", () => {
    expect(parseLocalizedNumber("brak", 7)).toBe(7);
  });
});
