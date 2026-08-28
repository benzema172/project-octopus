import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
const wrapperCss = readFileSync("components/company/hr/hr-workspace-146.module.css", "utf8");
const employeeRegressionCss = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-employee-list-1410.module.css", "utf8");

describe("Project Octopus HR action navigation", () => {
  it("keeps add-employee placement stable without a React portal", () => {
    expect(wrapper).not.toContain("createPortal");
    expect(wrapper).not.toContain("setActionHost");
    expect(wrapperCss).toContain('.employeesActive .workspaceSlot>div>details:not([open])');
    expect(wrapperCss).toContain("position:absolute");
    expect(wrapperCss).toContain("right:126px");
    expect(wrapperCss).toContain('summary{display:flex!important');
  });

  it("keeps the readable employee list contract", () => {
    expect(wrapper).toContain('data-hr-workspace-slot="employees-shell"');
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