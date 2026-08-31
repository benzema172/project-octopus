import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("HR simplified time records", () => {
  it("uses a simple day/month employee view for quick assignment", () => {
    const source = read("components/company/hr/hr-time-records-159.tsx");

    expect(source).toContain('type Period = "day" | "month"');
    expect(source).toContain('period === "day" ? [referenceDate] : monthDates(referenceDate)');
    expect(source).toContain(">Dzień</button>");
    expect(source).toContain(">Miesiąc</button>");
    expect(source).toContain("Pracownicy i czas pracy");
    expect(source).toContain("prosty spis pracowników — wybierz inwestycję, wpisz godziny, a szczegóły rozwiń przy konkretnej osobie");
    expect(source).toContain("Szczegóły robocizny");
    expect(source).toContain('data-hr-employee-detail-row="1"');
    expect(source).toContain('period === "day"');
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
