import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
const wrapperCss = readFileSync("components/company/hr/hr-workspace-146.module.css", "utf8");
const employeeCss = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-employee-list-141.module.css", "utf8");
const page = readFileSync("app/workspace/companies/[workspaceId]/hr/page.tsx", "utf8");

describe("Project Octopus 1.4.10 — HR actions and employee list regression", () => {
  it("keeps the compact add-employee action beside the CSV action and hides the old collapsed block", () => {
    expect(wrapper).toContain("createPortal");
    expect(wrapper).toContain("employeeAddAction");
    expect(wrapper).toContain("+ Dodaj pracownika");
    expect(wrapper).toContain('a[href*="/api/company/hr/export"]');
    expect(wrapperCss).toContain(".employeeAddAction{order:-1");
    expect(wrapperCss).toContain("details:not([open]){display:none!important}");
    expect(wrapperCss).toContain("details[open]>summary{display:none!important}");
  });

  it("preserves the readable employee numbering contract", () => {
    expect(page).toContain("hr-employee-list-141.module.css");
    expect(employeeCss).toContain("counter-reset: employee-row");
    expect(employeeCss).toContain("counter-increment: employee-row");
    expect(employeeCss).toContain('content: "LP."');
    expect(employeeCss).toContain("content: counter(employee-row)");
  });

  it("turns Octopus HR attention items into keyboard-accessible navigation actions", () => {
    expect(wrapper).toContain("data-hr-action-index");
    expect(wrapper).toContain('element.setAttribute("role", "button")');
    expect(wrapper).toContain('element.setAttribute("tabindex", "0")');
    expect(wrapper).toContain('event.key !== "Enter" && event.key !== " "');
    expect(wrapper).toContain('id === "pending-timesheets"');
    expect(wrapper).toContain('scrollToHeading("Do zatwierdzenia")');
    expect(wrapper).toContain('id === "missing-timesheet"');
    expect(wrapper).toContain("setWorkDateAndFocus");
    expect(wrapper).toContain('id === "pending-leave"');
    expect(wrapper).toContain('scrollToHeading("Wnioski do decyzji")');
    expect(wrapper).toContain('type === "expiry"');
    expect(wrapper).toContain('activateTab("compliance"');
    expect(wrapper).toContain('type === "allocation"');
    expect(wrapper).toContain('activateTab("teams"');
  });
});
