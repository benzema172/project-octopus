export type ProjectTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  sourceType: string | null;
  sourceId: string | null;
  assignedTo: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTaskSummary = {
  openCount: number;
  overdueCount: number;
  urgentCount: number;
  dueSoonCount: number;
  completedCount: number;
};

export type ProjectTaskSignal = ProjectTaskSummary & {
  nextTask: Pick<ProjectTask, "id" | "title" | "priority" | "dueAt"> | null;
};

export const PROJECT_TASK_CLOSED_STATUSES = ["completed", "done", "closed", "cancelled", "archived"] as const;

const CLOSED_STATUSES = new Set<string>(PROJECT_TASK_CLOSED_STATUSES);
const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, critical: 0, high: 1, normal: 2, medium: 2, low: 3 };

export function isProjectTaskClosed(status: string) {
  return CLOSED_STATUSES.has(status.trim().toLowerCase());
}

function timestamp(value: string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function utcDay(value: string | Date) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : null;
}

export function isProjectTaskOverdue(task: Pick<ProjectTask, "status" | "dueAt">, now: Date) {
  if (isProjectTaskClosed(task.status) || !task.dueAt) return false;
  const dueDay = utcDay(task.dueAt);
  const currentDay = utcDay(now);
  return dueDay != null && currentDay != null && dueDay < currentDay;
}

export function sortProjectTasks(tasks: ProjectTask[]) {
  return [...tasks].sort((left, right) => {
    const leftClosed = isProjectTaskClosed(left.status);
    const rightClosed = isProjectTaskClosed(right.status);
    if (leftClosed !== rightClosed) return leftClosed ? 1 : -1;
    const leftStatus = left.status.trim().toLowerCase();
    const rightStatus = right.status.trim().toLowerCase();
    if (leftStatus === "blocked" && rightStatus !== "blocked") return -1;
    if (rightStatus === "blocked" && leftStatus !== "blocked") return 1;
    const priorityDifference = (PRIORITY_WEIGHT[left.priority.trim().toLowerCase()] ?? 2) - (PRIORITY_WEIGHT[right.priority.trim().toLowerCase()] ?? 2);
    if (priorityDifference) return priorityDifference;
    const dueDifference = timestamp(left.dueAt) - timestamp(right.dueAt);
    if (dueDifference) return dueDifference;
    return left.title.localeCompare(right.title, "pl");
  });
}

export function summarizeProjectTasks(tasks: ProjectTask[], now: Date): ProjectTaskSummary {
  const currentDay = utcDay(now);
  let openCount = 0;
  let overdueCount = 0;
  let urgentCount = 0;
  let dueSoonCount = 0;
  let completedCount = 0;

  for (const task of tasks) {
    if (isProjectTaskClosed(task.status)) {
      completedCount += 1;
      continue;
    }
    openCount += 1;
    if (["urgent", "critical", "high"].includes(task.priority.trim().toLowerCase())) urgentCount += 1;
    const dueDay = task.dueAt ? utcDay(task.dueAt) : null;
    if (dueDay != null && currentDay != null && dueDay < currentDay) overdueCount += 1;
    else if (dueDay != null && currentDay != null && dueDay <= currentDay + 7) dueSoonCount += 1;
  }

  return { openCount, overdueCount, urgentCount, dueSoonCount, completedCount };
}
