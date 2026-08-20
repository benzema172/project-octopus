import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Control 360 compact decision workspace", () => {
  it("keeps the page focused on three decision layers and removes the full Autopilot showcase", () => {
    const page = read("app/workspace/projects/[projectId]/control/page.tsx");
    expect(page).toContain("Stan i ryzyka inwestycji");
    expect(page).toContain("CommandCenterPanel");
    expect(page).toContain("ReconciliationPanel");
    expect(page).toContain("ExecutionPanel");
    expect(page).not.toContain("AutopilotPanel");
    expect(page).toContain("control-360-compact.css");
  });

  it("reduces Command Center to health, priority, KPIs, actionable anomalies and compact cash flow", () => {
    const command = read("components/projects/project-command-center.tsx");
    expect(command).toContain("Aktualny priorytet");
    expect(command).toContain("Brak aktywnych anomalii i pilnych sygnałów");
    expect(command).toContain("Finanse i cash flow");
    expect(command).toContain("CompactDisclosureGroup");
    expect(command).not.toContain("Resource Planner");
    expect(command).not.toContain("Rejestr komunikacji");
    expect(command).not.toContain("Doświadczenia z innych inwestycji");
  });

  it("keeps reconciliation decisions available while grouping secondary tools into compact controls", () => {
    const graph = read("components/projects/project-reconciliation-graph.tsx");
    expect(graph).toContain("Elementy do decyzji");
    expect(graph).toContain("Operacje zakupowe");
    expect(graph).toContain("Dane techniczne");
    expect(graph).toContain("CompactDisclosureGroup");
    expect(graph).toContain("defaultOpenId");
    expect(graph).not.toContain("Enterprise reconciliation");
    expect(graph).not.toContain("command-kpis--secondary");
  });

  it("turns execution into compact checkpoints instead of six descriptive stage cards", () => {
    const execution = read("components/projects/project-execution-center.tsx");
    expect(execution).toContain("Kompletność realizacji");
    expect(execution).toContain("control360-stage-grid");
    expect(execution).toContain("control360-decision-grid");
    expect(execution).not.toContain("Etap {index + 1}");
    expect(execution).not.toContain("Mobilna budowa");
  });
});
