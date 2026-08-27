import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync("components/company/hr/hr-workspace-140.tsx", "utf8");
const calendar = readFileSync("components/company/hr/hr-time-records-145.tsx", "utf8");
const exportRoute = readFileSync("app/api/company/hr/export/route.ts", "utf8");

describe("Project Octopus 1.4.5 HR timesheet calendar", () => {
  it("uses the dedicated time-record component instead of opening the employee HR profile from the timesheet table", () => {
    expect(workspace).toContain('import { HrTimeRecords145 } from "./hr-time-records-145"');
    expect(workspace).toContain("<HrTimeRecords145");
    expect(workspace).not.toContain("<h2>Tygodniowa ewidencja</h2>");
    expect(calendar).toContain("selectedTimeEmployeeId");
    expect(calendar).toContain("Ewidencja czasu pracy");
  });

  it("supports 7-day and monthly views with project/hour detail", () => {
    expect(calendar).toContain('type Period = "week" | "month"');
    expect(calendar).toContain(">7 dni</button>");
    expect(calendar).toContain(">Miesiąc</button>");
    expect(calendar).toContain("Kalendarz pracy");
    expect(calendar).toContain("projectById");
    expect(calendar).toContain("overtime_hours");
  });

  it("exports the selected timesheet period and optional employee as CSV", () => {
    expect(calendar).toContain("Pobierz ewidencję");
    expect(calendar).toContain('mode: "timesheet"');
    expect(calendar).toContain('params.set("employeeId", employeeId)');
    expect(exportRoute).toContain('if (mode === "timesheet")');
    expect(exportRoute).toContain('url.searchParams.get("period") === "month"');
    expect(exportRoute).toContain('url.searchParams.get("employeeId")');
    expect(exportRoute).toContain("ewidencja-czasu-");
  });

  it("keeps the ordinary employee profile available from the employee register", () => {
    expect(workspace).toContain('onClick={() => setSelectedEmployeeId(String(row.id))}');
    expect(workspace).toContain("<EmployeeDrawer");
  });
});
