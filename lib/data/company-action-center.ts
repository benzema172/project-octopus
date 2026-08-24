import "server-only";

import { isProjectTaskOverdue } from "@/lib/investments/project-tasks";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type CompanyActionItem = {
  itemKey: string;
  domain: string;
  severity: "critical" | "high" | "warning" | "info" | string;
  priority: number;
  title: string;
  detail: string | null;
  projectId: string | null;
  entityType: string;
  entityId: string;
  href: string | null;
  dueAt: string | null;
  amount: number | null;
  createdAt: string;
};

type RpcRow = {
  item_key: string;
  domain: string;
  severity: string;
  priority: number;
  title: string;
  detail: string | null;
  project_id: string | null;
  entity_type: string;
  entity_id: string;
  href: string | null;
  due_at: string | null;
  amount: number | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  created_at: string;
};

function taskSeverity(task: TaskRow, now: Date) {
  const status = task.status.trim().toLowerCase();
  const priority = task.priority.trim().toLowerCase();
  const due = task.due_at ? Date.parse(task.due_at) : Number.NaN;
  if (status === "blocked" || ["urgent", "critical"].includes(priority) || isProjectTaskOverdue({ status, dueAt: task.due_at }, now)) return "critical";
  if (priority === "high" || (Number.isFinite(due) && due <= now.getTime() + 7 * 86_400_000)) return "warning";
  return "info";
}

export async function getCompanyActionCenter(workspaceId: string, limit = 100): Promise<CompanyActionItem[]> {
  const db = createServiceSupabaseClient();
  const safeLimit = Math.min(250, Math.max(1, limit));
  const [{ data, error }, { data: taskRows, error: taskError }] = await Promise.all([
    db.rpc("get_company_action_center_v2", { p_workspace_id: workspaceId, p_limit: safeLimit }),
    db.from("tasks")
      .select("id,project_id,title,description,status,priority,due_at,created_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "in_progress", "blocked"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(250)
      .returns<TaskRow[]>()
  ]);
  if (error) throw new Error(`Nie udało się pobrać kolejki działań: ${error.message}`);
  if (taskError) console.error("Project Octopus: company tasks unavailable", { workspaceId, message: taskError.message });
  const operational = ((data ?? []) as RpcRow[]).map((row) => ({
    itemKey: row.item_key,
    domain: row.domain,
    severity: row.severity,
    priority: Number(row.priority ?? 0),
    title: row.title,
    detail: row.detail,
    projectId: row.project_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    href: row.href,
    dueAt: row.due_at,
    amount: row.amount == null ? null : Number(row.amount),
    createdAt: row.created_at
  }));
  const now = new Date();
  const tasks: CompanyActionItem[] = (taskError ? [] : taskRows ?? []).map((task) => {
    const severity = taskSeverity(task, now);
    return {
      itemKey: `task:${task.id}`,
      domain: "investments",
      severity,
      priority: severity === "critical" ? 98 : severity === "warning" ? 78 : 48,
      title: task.title,
      detail: task.description || (task.status === "in_progress" ? "Działanie jest w toku." : "Działanie czeka na rozpoczęcie."),
      projectId: task.project_id,
      entityType: "task",
      entityId: task.id,
      href: task.project_id ? `/workspace/projects/${task.project_id}/tasks` : `/workspace/companies/${workspaceId}`,
      dueAt: task.due_at,
      amount: null,
      createdAt: task.created_at
    };
  });
  const uniqueItems = new Map<string, CompanyActionItem>();
  for (const item of [...operational, ...tasks]) {
    const current = uniqueItems.get(item.itemKey);
    if (!current || item.priority > current.priority) uniqueItems.set(item.itemKey, item);
  }
  return [...uniqueItems.values()]
    .sort((left, right) => right.priority - left.priority || (left.dueAt ? Date.parse(left.dueAt) : Number.MAX_SAFE_INTEGER) - (right.dueAt ? Date.parse(right.dueAt) : Number.MAX_SAFE_INTEGER) || Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, safeLimit);
}

export async function refreshOperationalNotifications(workspaceId: string) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("refresh_operational_notifications_atomic", { p_workspace_id: workspaceId });
  if (error) throw new Error(`Nie udało się odświeżyć alertów: ${error.message}`);
  return data;
}
