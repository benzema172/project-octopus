"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  CircleAlert,
  ListChecks,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Search,
  X
} from "lucide-react";
import {
  isProjectTaskClosed,
  isProjectTaskOverdue,
  sortProjectTasks,
  summarizeProjectTasks,
  type ProjectTask
} from "@/lib/investments/project-tasks";

type Filter = "active" | "overdue" | "completed" | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "Aktywne" },
  { value: "overdue", label: "Po terminie" },
  { value: "completed", label: "Zakończone" },
  { value: "all", label: "Wszystkie" }
];

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Pilne",
  critical: "Krytyczne",
  high: "Wysokie",
  normal: "Normalne",
  medium: "Średnie",
  low: "Niskie"
};

const STATUS_LABELS: Record<string, string> = {
  open: "Do zrobienia",
  in_progress: "W toku",
  blocked: "Zablokowane",
  completed: "Zakończone",
  done: "Zakończone",
  cancelled: "Anulowane"
};

function dateLabel(value: string | null) {
  if (!value) return "Bez terminu";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Bez terminu";
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function taskFromResponse(value: unknown): ProjectTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<ProjectTask>;
  return task.id && task.title && task.status && task.priority && task.createdAt && task.updatedAt ? task as ProjectTask : null;
}

export function ProjectTaskWorkspace({ projectId, initialTasks, canWrite, referenceTime }: { projectId: string; initialTasks: ProjectTask[]; canWrite: boolean; referenceTime: string }) {
  const router = useRouter();
  const createPanelRef = useRef<HTMLDetailsElement>(null);
  const [tasks, setTasks] = useState(() => sortProjectTasks(initialTasks));
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const referenceDate = useMemo(() => new Date(referenceTime), [referenceTime]);
  const summary = summarizeProjectTasks(tasks, referenceDate);

  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pl-PL");
    return tasks.filter((task) => {
      if (filter === "active" && isProjectTaskClosed(task.status)) return false;
      if (filter === "overdue" && !isProjectTaskOverdue(task, referenceDate)) return false;
      if (filter === "completed" && !isProjectTaskClosed(task.status)) return false;
      if (!normalized) return true;
      return `${task.title} ${task.description ?? ""}`.toLocaleLowerCase("pl-PL").includes(normalized);
    });
  }, [filter, query, referenceDate, tasks]);

  async function run(payload: Record<string, unknown>) {
    const response = await fetch("/api/projects/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, ...payload })
    });
    const result = await response.json() as { error?: string; task?: unknown };
    if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać działania.");
    return taskFromResponse(result.task);
  }

  function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const task = await run({ action: "task_create", ...values });
        if (task) setTasks((current) => sortProjectTasks([task, ...current]));
        form.reset();
        createPanelRef.current?.removeAttribute("open");
        setFilter("active");
        setMessage("Działanie zostało dodane do planu.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Nie udało się dodać działania.");
      }
    });
  }

  function changeStatus(task: ProjectTask, status: "open" | "in_progress" | "completed") {
    setMessage(null);
    setError(null);
    setPendingId(task.id);
    startTransition(async () => {
      try {
        const updated = await run({ action: "task_status_update", taskId: task.id, taskUpdatedAt: task.updatedAt, status });
        if (updated) setTasks((current) => sortProjectTasks(current.map((item) => item.id === updated.id ? updated : item)));
        setMessage(status === "completed" ? "Działanie zostało zakończone." : "Status działania został zmieniony.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Nie udało się zmienić statusu.");
        router.refresh();
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="project-tab-content pw-actions-page">
      <header className="pw-actions-heading">
        <div>
          <p className="co-kicker">Plan działań</p>
          <h2>Jedna lista odpowiedzialności inwestycji</h2>
          <p>Ręczne zadania, działania z terminem i czynności wynikające z pracy zespołu w jednym porządku.</p>
        </div>
        {canWrite ? (
          <details className="pw-action-create" ref={createPanelRef}>
            <summary><Plus size={16} aria-hidden="true" /> Dodaj działanie</summary>
            <form onSubmit={createTask}>
              <label className="pw-action-create__wide"><span>Tytuł *</span><input name="title" required maxLength={180} /></label>
              <label className="pw-action-create__wide"><span>Opis</span><textarea name="description" rows={3} maxLength={1200} /></label>
              <label><span>Priorytet</span><select name="priority" defaultValue="normal"><option value="urgent">Pilne</option><option value="high">Wysokie</option><option value="normal">Normalne</option><option value="low">Niskie</option></select></label>
              <label><span>Termin</span><input name="dueAt" type="date" /></label>
              <button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Zapisz</button>
            </form>
          </details>
        ) : null}
      </header>

      <section className="pw-action-summary" aria-label="Podsumowanie planu działań">
        <div><ListChecks size={17} /><span><small>Otwarte</small><strong>{summary.openCount}</strong></span></div>
        <div data-tone={summary.overdueCount ? "danger" : "calm"}><CircleAlert size={17} /><span><small>Po terminie</small><strong>{summary.overdueCount}</strong></span></div>
        <div data-tone={summary.urgentCount ? "warning" : "calm"}><CalendarClock size={17} /><span><small>Wysoki priorytet</small><strong>{summary.urgentCount}</strong></span></div>
        <div data-tone="success"><CheckCircle2 size={17} /><span><small>Zakończone</small><strong>{summary.completedCount}</strong></span></div>
      </section>

      <section className="pw-action-register" aria-labelledby="project-action-register-heading">
        <div className="pw-action-toolbar">
          <div className="pw-action-filters" aria-label="Filtr działań">
            {FILTERS.map((item) => <button type="button" key={item.value} className={filter === item.value ? "is-active" : undefined} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
          </div>
          <label className="pw-action-search"><Search size={15} aria-hidden="true" /><span className="ux-sr-only">Szukaj w planie działań</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj…" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Wyczyść wyszukiwanie"><X size={14} /></button> : null}</label>
        </div>

        <div className="pw-action-register__heading"><h3 id="project-action-register-heading">{visibleTasks.length} {visibleTasks.length === 1 ? "działanie" : "działań"}</h3><span>Priorytet i termin wyznaczają kolejność</span></div>

        {visibleTasks.length ? (
          <div className="pw-action-list">
            {visibleTasks.map((task) => {
              const closed = isProjectTaskClosed(task.status);
              const overdue = isProjectTaskOverdue(task, referenceDate);
              const rowPending = pending && pendingId === task.id;
              return (
                <article key={task.id} data-state={closed ? "completed" : overdue ? "overdue" : task.status}>
                  <span className="pw-action-state-icon">{closed ? <CheckCircle2 size={17} /> : task.status === "in_progress" ? <Play size={16} /> : task.status === "blocked" || overdue ? <CircleAlert size={17} /> : <Circle size={17} />}</span>
                  <div className="pw-action-copy">
                    <div><strong>{task.title}</strong><span data-priority={task.priority}>{PRIORITY_LABELS[task.priority] ?? task.priority}</span></div>
                    {task.description ? <p>{task.description}</p> : null}
                    <small className={overdue ? "is-overdue" : undefined}><CalendarClock size={13} /> {overdue ? "Po terminie: " : "Termin: "}{dateLabel(task.dueAt)} · {STATUS_LABELS[task.status] ?? task.status}{task.sourceType && task.sourceType !== "manual" ? " · źródło Octopus" : ""}</small>
                  </div>
                  {canWrite ? (
                    <div className="pw-action-row-actions">
                      {rowPending ? <LoaderCircle className="spin" size={17} /> : closed ? <button type="button" onClick={() => changeStatus(task, "open")} disabled={pending} title="Otwórz ponownie"><RotateCcw size={15} /><span>Otwórz</span></button> : <><button type="button" onClick={() => changeStatus(task, "in_progress")} disabled={pending || task.status === "in_progress"} title="Rozpocznij"><Play size={15} /><span>W toku</span></button><button type="button" className="is-primary" onClick={() => changeStatus(task, "completed")} disabled={pending} title="Zakończ"><Check size={15} /><span>Zakończ</span></button></>}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="pw-action-empty"><CheckCircle2 size={22} /><div><strong>{tasks.length ? "Brak działań w tym widoku" : "Plan działań jest pusty"}</strong><p>{tasks.length ? "Zmień filtr lub wyszukiwaną frazę." : "Dodaj pierwszą odpowiedzialność albo pozwól Octopusowi utworzyć ją z procesu inwestycji."}</p></div></div>
        )}
      </section>

      {message ? <p className="pw-action-feedback is-success" role="status"><CheckCircle2 size={16} /> {message}</p> : null}
      {error ? <p className="pw-action-feedback is-error" role="alert"><CircleAlert size={16} /> {error}</p> : null}
    </div>
  );
}
