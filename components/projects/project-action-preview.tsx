import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, ListChecks } from "lucide-react";
import { ProjectTodayIntelligence130 } from "@/components/projects/project-today-intelligence-130";
import { isProjectTaskClosed, isProjectTaskOverdue, summarizeProjectTasks, type ProjectTask } from "@/lib/investments/project-tasks";

function formatDue(value: string | null) {
  if (!value) return "bez terminu";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "bez terminu";
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "short" }).format(date);
}

export function ProjectActionPreview({ projectId, tasks, canWrite, referenceTime }: { projectId: string; tasks: ProjectTask[]; canWrite: boolean; referenceTime: string }) {
  const active = tasks.filter((task) => !isProjectTaskClosed(task.status)).slice(0, 4);
  const referenceDate = new Date(referenceTime);
  const summary = summarizeProjectTasks(tasks, referenceDate);
  const base = `/workspace/projects/${projectId}/tasks`;

  return (
    <>
      <ProjectTodayIntelligence130 projectId={projectId} />
      <section className="pw-action-preview" aria-labelledby="project-action-preview-heading">
        <div className="pw-action-preview__heading">
          <span><ListChecks size={18} /></span>
          <div><p className="co-kicker">Najbliższe działania</p><h2 id="project-action-preview-heading">Plan pracy inwestycji</h2></div>
          <div className="pw-action-preview__counts"><strong>{summary.openCount} otwartych</strong>{summary.overdueCount ? <span><CircleAlert size={13} /> {summary.overdueCount} po terminie</span> : <span className="is-calm"><CheckCircle2 size={13} /> Terminy pod kontrolą</span>}</div>
        </div>
        {active.length ? <div className="pw-action-preview__list">{active.map((task) => {
          const overdue = isProjectTaskOverdue(task, referenceDate);
          return <Link href={base} key={task.id} data-tone={overdue ? "danger" : task.priority === "urgent" || task.priority === "high" ? "warning" : "default"}><span>{overdue ? <CircleAlert size={15} /> : <CalendarClock size={15} />}</span><strong>{task.title}</strong><small>{overdue ? "po terminie" : formatDue(task.dueAt)}</small></Link>;
        })}</div> : <div className="pw-action-preview__empty"><CheckCircle2 size={17} /><span><strong>Brak otwartych działań.</strong><small>{canWrite ? "Dodaj pierwsze działanie, aby ustalić odpowiedzialność i termin." : "Aktualny plan nie wymaga reakcji."}</small></span></div>}
        <Link className="pw-action-preview__open" href={base}>{active.length ? "Otwórz cały plan" : canWrite ? "Utwórz plan działań" : "Zobacz plan"} <ArrowRight size={14} /></Link>
      </section>
    </>
  );
}
