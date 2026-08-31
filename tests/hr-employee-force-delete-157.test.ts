import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Project Octopus HR employee force delete", () => {
  const api = readFileSync("app/api/company/hr/employee/route.ts", "utf8");
  const registry = readFileSync("components/company/hr/hr-employee-registry-300.tsx", "utf8");

  it("keeps ordinary delete protected while exposing an explicit force-delete path", () => {
    expect(api).toContain('"delete" | "force_delete"');
    expect(api).toContain('if (body.action === "delete")');
    expect(api).toContain("firstLinkedRecord(db, workspace.id, employeeId)");
    expect(api).toContain('if (body.action === "force_delete")');
    expect(api).toContain("if (!hrApprove)");
    expect(api).toContain('text(body.payload.confirmation) !== "USUŃ"');
    expect(api).toContain('await audit("employee_force_deleted", snapshot)');
  });

  it("requires a conscious two-step confirmation in the current employee card", () => {
    expect(registry).toContain("Trwale usunąć");
    expect(registry).toContain('window.prompt("Wpisz dokładnie: USUŃ")');
    expect(registry).toContain('action: "force_delete"');
    expect(registry).toContain('confirmation: "USUŃ"');
    expect(registry).toContain('canApprove ? "force_delete" : "delete"');
    expect(registry).toContain("wraz z historią HR");
  });
});
