import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrapper = readFileSync("components/company/hr/hr-workspace-147.tsx", "utf8");
const wrapperCss = readFileSync("components/company/hr/hr-workspace-146.module.css", "utf8");
const employeeRegressionCss = readFileSync("app/workspace/companies/[workspaceId]/hr/hr-employee-list-1410.module.css", "utf8");

describe("Project Octopus 1.4.11 — HR action navigation", () => {
  it("places the compact add-employee action in the same action host as Raport CSV", () => {
    expect(wrapper).toContain("createPortal");
    expect(wrapper).toContain('a[href*="/api/company/hr/export"]');
    expect(wrapper).toContain("setActionHost(exportLink?.parentElement ?? null)");
    expect(wrapper).toContain("employeeAddAction");
    expect(wrapper).toContain("+ Dodaj pracownika");
    expect(wrapperCss).toContain(".employeeAddAction{order:-1");
    expect(wrapperCss).toContain("details:not([open]){display:none!important}");
  });

  it("keeps the 1.4.10 readable employee list contract while adding actions", () => {
    expect(wrapper).toContain('data-hr-workspace-slot="employees-shell"');
    expect(employeeRegressionCss).toContain('content: "LP."');
    expect(employeeRegressionCss).toContain("content: counter(employee-row)");
    expect(employeeRegressionCss).toContain("tbody td:first-child > div");
  });

  it("turns Octopus HR attention rows into keyboard-accessible navigation actions", () => {
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
  });
});
