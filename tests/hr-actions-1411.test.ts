import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
const wrapperCss = readFileSync("components/company/hr/hr-workspace-146.module.css", "utf8");
const workspace = readFileSync("components/company/hr/hr-workspace-140.tsx", "utf8");
const workspaceCss = readFileSync("components/company/hr/hr-workspace-140.module.css", "utf8");
const employeeRegressionCss = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-employee-list-1410.module.css", "utf8");

describe("Project Octopus HR action navigation", () => {
  it("keeps both toolbar actions in normal layout without absolute positioning", () => {
    expect(wrapper).not.toContain("createPortal");
    expect(wrapper).not.toContain("setActionHost");
    expect(wrapper).not.toContain("employeesActive");
    expect(wrapperCss).not.toContain(".employeesActive");
    expect(workspace).toContain('tab === "employees"');
    expect(workspace).toContain("setEmployeeCreateOpen(true)");
    expect(workspace).toContain("Raport CSV");
    expect(workspaceCss).toContain(".actions{display:flex;gap:8px");
    expect(workspaceCss).toContain("flex:0 0 auto");
  });

  it("opens add employee as a real modal instead of expanding a details block", () => {
    expect(workspace).toContain("employeeCreateOpen ? <EmployeeCreateModal");
    expect(workspace).toContain('role="dialog" aria-modal="true"');
    expect(workspace).toContain('aria-labelledby="employee-create-title"');
    expect(workspace).toContain('aria-label="Zamknij dodawanie pracownika"');
    expect(workspace).toContain('event.key === "Escape"');
    expect(workspace).not.toContain('<FormBlock title="Dodaj pracownika">');
    expect(workspaceCss).toContain(".modalLayer{position:fixed;inset:0");
    expect(workspaceCss).toContain(".employeeModal{position:relative");
  });

  it("keeps the readable employee list contract", () => {
    expect(wrapper).toContain('data-hr-workspace-slot="employees-shell"');
    expect(workspace).toContain("data-hr-employee-list");
    expect(employeeRegressionCss).toContain('content: "LP."');
    expect(employeeRegressionCss).toContain("content: counter(employee-row)");
    expect(employeeRegressionCss).toContain("tbody td:first-child > div");
  });

  it("turns Octopus HR attention rows into visible keyboard-accessible actions", () => {
    expect(wrapper).toContain("data-hr-action-index");
    expect(wrapper).toContain('element.setAttribute("role", "button")');
    expect(wrapper).toContain('element.setAttribute("tabindex", "0")');
    expect(wrapper).toContain('event.key !== "Enter" && event.key !== " "');
    expect(wrapper).toContain('title.includes("kart czasu")');
    expect(wrapper).toContain('scrollToHeading("Do zatwierdzenia")');
    expect(wrapper).toContain('title.includes("bez wpisu czasu")');
    expect(wrapper).toContain("setWorkDateAndFocus(date)");
    expect(wrapper).toContain('title.includes("wniosków urlopowych")');
    expect(wrapper).toContain('activateTab("leaves"');
    expect(wrapper).toContain('type === "compliance"');
    expect(wrapper).toContain('activateTab("compliance"');
    expect(wrapper).toContain('type === "allocation"');
    expect(wrapper).toContain('activateTab("teams"');
    expect(wrapperCss).toContain('content:"Otwórz →"');
  });
});
