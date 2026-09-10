import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("components/company/hr/hr-attendance-list-500.tsx", "utf8");
const styles = readFileSync("components/company/hr/hr-attendance-list-500.module.css", "utf8");

describe("HR attendance list 5.2 collapsed employee registry and period reports", () => {
  it("starts with every employee collapsed and allows only one monthly employee view at a time", () => {
    expect(component).toContain("const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);");
    expect(component).not.toContain("useState<Set<string>>(() => new Set())");
    expect(component).toContain("const expanded = expandedEmployeeId === employeeId;");
    expect(component).toContain('className={styles.employeeList}');
    expect(component).toContain("aria-expanded={expanded}");
    expect(component).not.toContain("Wszyscy pracownicy");
  });

  it("keeps only vacation-day statistics on each monthly attendance sheet", () => {
    expect(component).toContain('<span className={styles.vacationSummary}><b>{vacationDays}</b> dni urlopu</span>');
    expect(component).not.toContain("dni pracy</span><span><b>{hoursLabel(totalHours)}");
    expect(component).not.toContain("inne nieobecności</span>{missingDays");
  });

  it("offers annual and arbitrary date-range summaries per employee and replaces the monthly heavy view", () => {
    expect(component).toContain("generateYearReport(employeeId)");
    expect(component).toContain("Od daty do daty");
    expect(component).toContain("generateRangeReport(employeeId)");
    expect(component).toContain("Podsumowanie roczne ${selectedYear}");
    expect(component).toContain("PODSUMOWANIE OBECNOŚCI");
    expect(component).toContain("Drukuj / Zapisz PDF");
    expect(component).toContain("setExpandedEmployeeId(null);");
    expect(component).toContain("setReport(null);");
    expect(component).toContain("setRangeEmployeeId(null);");
  });

  it("keeps monthly sheets and generated period reports printable while preserving the compact table layout", () => {
    expect(styles).toContain(".employeeList");
    expect(styles).toContain(".reportCard");
    expect(styles).toContain(".printDocument{display:none}");
    expect(styles).toContain("@media print");
  });
});
