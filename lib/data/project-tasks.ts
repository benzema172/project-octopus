import "server-only";

import {
  isProjectTaskClosed,
  PROJECT_TASK_CLOSED_STATUSES,
  sortProjectTasks,
  summarizeProjectTasks,
  type ProjectTask,
  type ProjectTaskSignal
} from "@/lib/investments/project-tasks";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  source_type: string | null;
  source_id: string | null;
  assigned_to: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  project_id?: string | null;
};

function taskFromRow(row: TaskRow): ProjectTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status.trim().toLowerCase(),
    priority: row.priority.trim().toLowerCase(),
    sourceType: row.source_type,
    sourceId: row.source_id,
    assignedTo: row.assigned_to,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listProjectTasks(workspaceId: string, projectId: string): Promise<ProjectTask[]> {
  const db = createServiceSupabaseClient();
  const fields = "id,title,description,status,priority,source_type,source_id,assigned_to,due_at,completed_at,created_at,updated_at";
  const closedFilter = `(${PROJECT_TASK_CLOSED_STATUSES.join(",")})`;
  const [activeResult, completedResult] = await Promise.all([
    db.from("tasks")
      .select(fields)
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .not("status", "in", closedFilter)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(300)
      .returns<TaskRow[]>(),
    db.from("tasks")
      .select(fields)
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .in("status", [...PROJECT_TASK_CLOSED_STATUSES])
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(75)
      .returns<TaskRow[]>()
  ]);

  if (activeResult.error) throw new Error(`Nie udało się pobrać aktywnego planu działań: ${activeResult.error.message}`);
  if (completedResult.error) throw new Error(`Nie udało się pobrać historii działań: ${completedResult.error.message}`);
  return sortProjectTasks([...(activeResult.data ?? []), ...(completedResult.data ?? [])].map(taskFromRow));
}

export async function getProjectTaskSignals(workspaceId: string, projectIds: string[]): Promise<Record<string, ProjectTaskSignal>> {
  if (!projectIds.length) return {};
  const { data, error } = await createServiceSupabaseClient()
    .from("tasks")
    .select("id,project_id,title,description,status,priority,source_type,source_id,assigned_to,due_at,completed_at,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .in("project_id", projectIds)
    .not("status", "in", `(${PROJECT_TASK_CLOSED_STATUSES.join(",")})`)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(2000)
    .returns<TaskRow[]>();

  if (error) throw new Error(`Nie udało się pobrać sygnałów portfela: ${error.message}`);

  const grouped = new Map<string, ProjectTask[]>();
  for (const row of data ?? []) {
    if (!row.project_id) continue;
    const tasks = grouped.get(row.project_id) ?? [];
    tasks.push(taskFromRow(row));
    grouped.set(row.project_id, tasks);
  }

  return Object.fromEntries(projectIds.map((projectId) => {
    const tasks = sortProjectTasks(grouped.get(projectId) ?? []);
    const summary = summarizeProjectTasks(tasks, new Date());
    const next = tasks.find((task) => !isProjectTaskClosed(task.status));
    return [projectId, {
      ...summary,
      nextTask: next ? { id: next.id, title: next.title, priority: next.priority, dueAt: next.dueAt } : null
    } satisfies ProjectTaskSignal];
  }));
}
