import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync("components/company/hr/hr-workspace-140.tsx", "utf8");
const calendar = readFileSync("components/company/hr/hr-time-records-145.tsx", "utf8");
const modalCss = readFileSync("components/company/hr/hr-time-records-155.module.css", "utf8");
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

  it("opens employee time records as a centered viewport modal instead of the old side drawer", () => {
    expect(calendar).toContain('import { createPortal } from "react-dom"');
    expect(calendar).toContain("createPortal(");
    expect(calendar).toContain('aria-labelledby="time-records-employee-title"');
    expect(calendar).not.toContain("styles.drawer");
    expect(calendar).not.toContain("styles.profileLayer");
    expect(modalCss).toContain(".layer{position:fixed;inset:0");
    expect(modalCss).toContain("place-items:center");
    expect(modalCss).toContain("width:min(1120px");
    expect(modalCss).toContain("max-height:min(900px");
    expect(modalCss).toContain("overflow-y:auto");
  });

  it("shows a readable vertical day table and complete period summary", () => {
    expect(calendar).toContain("Inwestycja / zakres");
    expect(calendar).toContain("Godziny podstawowe");
    expect(calendar).toContain("Nadgodziny");
    expect(calendar).toContain("Dni z wpisem");
    expect(calendar).toContain("selectedBaseHours");
    expect(calendar).toContain("selectedOvertime");
    expect(calendar).toContain("selectedTotal");
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
