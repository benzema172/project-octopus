import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isProjectTaskClosed,
  isProjectTaskOverdue,
  sortProjectTasks,
  summarizeProjectTasks,
  type ProjectTask
} from "../lib/investments/project-tasks";

const read = (path: string) => readFileSync(path, "utf8");

function task(overrides: Partial<ProjectTask>): ProjectTask {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "Działanie",
    description: overrides.description ?? null,
    status: overrides.status ?? "open",
    priority: overrides.priority ?? "normal",
    sourceType: overrides.sourceType ?? "manual",
    sourceId: overrides.sourceId ?? null,
    assignedTo: overrides.assignedTo ?? null,
    dueAt: overrides.dueAt ?? null,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-08-20T08:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-20T08:00:00.000Z"
  };
}

describe("investment action plan", () => {
  it("summarizes open, overdue, urgent and completed work against a stable reference time", () => {
    const tasks = [
      task({ priority: "urgent", dueAt: "2026-08-20T12:00:00.000Z" }),
      task({ priority: "normal", dueAt: "2026-08-24T12:00:00.000Z" }),
      task({ status: "completed", completedAt: "2026-08-19T12:00:00.000Z" })
    ];

    expect(summarizeProjectTasks(tasks, new Date("2026-08-21T12:00:00.000Z"))).toEqual({
      openCount: 2,
      overdueCount: 1,
      urgentCount: 1,
      dueSoonCount: 1,
      completedCount: 1
    });
    expect(isProjectTaskClosed("completed")).toBe(true);
    expect(isProjectTaskClosed("in_progress")).toBe(false);
    expect(isProjectTaskOverdue(task({ dueAt: "2026-08-21T12:00:00.000Z" }), new Date("2026-08-21T22:00:00.000Z"))).toBe(false);
  });

  it("puts blockers and high-priority work before normal and completed records", () => {
    const sorted = sortProjectTasks([
      task({ id: "done", status: "completed", priority: "urgent" }),
      task({ id: "normal", priority: "normal", dueAt: "2026-08-22T12:00:00.000Z" }),
      task({ id: "urgent", priority: "urgent", dueAt: "2026-08-23T12:00:00.000Z" }),
      task({ id: "blocked", status: "blocked", priority: "low" })
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["blocked", "urgent", "normal", "done"]);
  });

  it("authorizes task mutations against the real project and writes an audit trail", () => {
    const route = read("app/api/projects/operations/route.ts");
    expect(route).toContain('body.action === "task_create"');
    expect(route).toContain('body.action === "task_status_update"');
    expect(route).toContain('.eq("workspace_id", workspaceId)');
    expect(route).toContain('.eq("project_id", project.id)');
    expect(route).toContain('event_type: "task.created"');
    expect(route).toContain('event_type: "task.status_changed"');
    expect(route).toContain("taskUpdatedAt");
    expect(route).toContain("OperationConflictError");
  });

  it("connects the task plan to project navigation, dashboard, portfolio and company action center", () => {
    const navigation = read("components/projects/project-navigation.tsx");
    const dashboard = read("app/workspace/projects/[projectId]/page.tsx");
    const investments = read("components/projects/company-investments-view.tsx");
    const actionCenter = read("lib/data/company-action-center.ts");
    expect(navigation).toContain('href: `${base}/tasks`, label: "Plan działań"');
    expect(dashboard).toContain("<ProjectActionPreview");
    expect(investments).toContain("Wymagają uwagi");
    expect(investments).toContain("taskSignals");
    expect(actionCenter).toContain('itemKey: `task:${task.id}`');
    expect(actionCenter).toContain('/tasks`');
  });

  it("keeps the task workspace compact and responsive", () => {
    const css = read("app/project-actions.css");
    const workspace = read("components/projects/project-task-workspace.tsx");
    expect(css).toContain(".pw-action-register");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toContain("@media (max-width: 680px)");
    expect(workspace).toContain('aria-label="Filtr działań"');
    expect(workspace).toContain('action: "task_status_update"');
  });
});
