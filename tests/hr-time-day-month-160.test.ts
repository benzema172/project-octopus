import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR simplified time records", () => {
  it("uses a simple day/month employee view for quick assignment", () => {
    const source = read("components/company/hr/hr-time-records-400.tsx");

    expect(source).toContain('type ViewMode = "day" | "week" | "month" | "history"');
    expect(source).toContain('["day", "week", "month", "history"]');
    expect(source).toContain('item === "day" ? "Dzień"');
    expect(source).toContain('item === "month" ? "Miesiąc"');
    expect(source).toContain("Ewidencja, lokalizacja i historia pracy");
    expect(source).toContain("Pełne szczegóły");
    expect(source).toContain('mode === "day"');
    expect(source).toContain('mode === "month"');
    expect(source).toContain('variant="inline"');
    expect(source).toContain('variant="cell"');
  });

  it("keeps daily CSV export while preserving the legacy 7-day API fallback", () => {
    const route = read("app/api/company/hr/export/route.ts");

    expect(route).toContain('periodParam === "day" ? "day" : "week"');
    expect(route).toContain('? { from: referenceDate, to: referenceDate }');
    expect(route).toContain('`dzien-${referenceDate}`');
    expect(route).toContain('`7-dni-${range.from}-${range.to}`');
  });
});
