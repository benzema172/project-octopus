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
    expect(source).toContain("prosty spis pracowników — wybierz inwestycję i wpisz godziny");
    expect(source).toContain("<HrTimesheetEntryEditor159");
  });

  it("keeps daily CSV export while preserving the legacy 7-day API fallback", () => {
    const route = read("app/api/company/hr/export/route.ts");

    expect(route).toContain('periodParam === "day" ? "day" : "week"');
    expect(route).toContain('? { from: referenceDate, to: referenceDate }');
    expect(route).toContain('`dzien-${referenceDate}`');
    expect(route).toContain('`7-dni-${range.from}-${range.to}`');
  });
});
