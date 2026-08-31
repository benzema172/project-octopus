import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Kadry 1.5.2 employee registry actions", () => {
  const registry = readFileSync("components/company/hr/hr-employee-registry-152.tsx", "utf8");
  const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
  const managementRoute = readFileSync("app/api/company/hr/employee/route.ts", "utf8");
  const calendarRoute = readFileSync("app/api/company/hr/employee-calendar/route.ts", "utf8");

  it("shows exactly the requested edit and calendar actions next to each employee", () => {
    expect(registry).toContain('title="Edytuj / archiwizuj pracownika"');
    expect(registry).toContain('title="Kalendarz pracy"');
    expect(registry).toContain("<Pencil size={17} />");
    expect(registry).toContain("<CalendarDays size={17} />");
  });

  it("supports editing, archiving, restoring and permission-aware permanent deletion", () => {
    expect(registry).toContain('action: "update"');
    expect(registry).toContain('changeEmployeeState(String(editEmployee.id), "archive")');
    expect(registry).toContain('changeEmployeeState(String(editEmployee.id), "restore")');
    expect(registry).toContain('canApprove ? "force_delete" : "delete"');
    expect(managementRoute).toContain('type Action = "update" | "archive" | "restore" | "delete" | "force_delete"');
    expect(managementRoute).toContain("Nie można usunąć pracownika, ponieważ ma zapisaną historię");
    expect(managementRoute).toContain("Trwałe usunięcie pracownika wraz z historią wymaga uprawnienia");
  });

  it("loads a real month-scoped day-by-day timesheet calendar", () => {
    expect(registry).toContain("employee-calendar?");
    expect(registry).toContain("Poprzedni miesiąc");
    expect(registry).toContain("Następny miesiąc");
    expect(registry).toContain("daysInMonth(month)");
    expect(calendarRoute).toContain('.eq("employee_id", employeeId)');
    expect(calendarRoute).toContain('.gte("work_date", from)');
    expect(calendarRoute).toContain('.lt("work_date", to)');
  });

  it("replaces only the legacy employee list while keeping the rest of Kadry intact", () => {
    expect(wrapper).toContain("HrEmployeeRegistry152");
    expect(wrapper).toContain("registryVisible ? registryStyles.enhancedEmployees");
    expect(wrapper).toContain("registryVisible ? <HrEmployeeRegistry152");
  });
});
