"use client";

import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, X } from "lucide-react";
import styles from "./hr-timesheet-entry-editor-159.module.css";

type Row = Record<string, unknown>;

type Props = {
  workspaceId: string;
  employeeId: string;
  employeeName?: string;
  workDate: string;
  projects: Row[];
  entries: Row[];
  canWrite: boolean;
  variant: "inline" | "cell";
  suggestedProjectId?: string;
};

function num(value: unknown, digits = 1) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0);
}

function entryHours(row: Row) {
  return Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0);
}

function dayLabel(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return parsed.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function HrTimesheetEntryEditor159({ workspaceId, employeeId, employeeName, workDate, projects, entries, canWrite, variant, suggestedProjectId = "" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(entries.length === 0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectById = new Map(projects.map((row) => [String(row.id), String(row.name ?? "Inwestycja")]));
  const total = entries.reduce((sum, row) => sum + entryHours(row), 0);
  const projectNames = Array.from(new Set(entries.map((row) => row.project_id ? projectById.get(String(row.project_id)) ?? "Inwestycja" : "Koszt ogólny")));

  const request = async (action: "create" | "update" | "delete", payload: Record<string, unknown>, busyKey: string) => {
    if (!canWrite || !workspaceId) return;
    setBusyId(busyKey);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/company/hr/timesheet-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action, payload })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać czasu pracy.");
      setMessage(action === "delete" ? "Wpis usunięto." : action === "create" ? "Wpis dodano." : "Zmiany zapisano.");
      if (action === "create") setAdding(false);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać czasu pracy.");
    } finally {
      setBusyId(null);
    }
  };

  const submitEntry = (entry?: Row) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const id = entry?.id ? String(entry.id) : "new";
    await request(entry?.id ? "update" : "create", entry?.id ? {
      timesheetId: entry.id,
      projectId: values.projectId,
      hours: values.hours,
      overtimeHours: values.overtimeHours
    } : {
      employeeId,
      workDate,
      projectId: values.projectId,
      hours: values.hours,
      overtimeHours: values.overtimeHours
    }, id);
  };

  const removeEntry = async (entry: Row) => {
    if (!entry.id || !canWrite) return;
    if (!window.confirm("Usunąć ten wpis czasu pracy?")) return;
    await request("delete", { timesheetId: entry.id }, String(entry.id));
  };

  const formFor = (entry?: Row, key = "new") => <form className={styles.entryRow} onSubmit={submitEntry(entry)} key={key}>
    <label className={styles.field}>
      <span>Inwestycja</span>
      <select name="projectId" defaultValue={entry?.project_id ? String(entry.project_id) : suggestedProjectId} disabled={!canWrite || busyId !== null}>
        <option value="">Koszt ogólny / bez inwestycji</option>
        {projects.map((project) => <option value={String(project.id)} key={String(project.id)}>{String(project.name ?? "Inwestycja")}</option>)}
      </select>
    </label>
    <label className={styles.field}>
      <span>Godziny</span>
      <input name="hours" inputMode="decimal" defaultValue={entry ? String(entry.hours ?? "") : "8"} required disabled={!canWrite || busyId !== null} />
    </label>
    <label className={styles.field}>
      <span>Nadg.</span>
      <input name="overtimeHours" inputMode="decimal" defaultValue={entry ? String(entry.overtime_hours ?? 0) : "0"} disabled={!canWrite || busyId !== null} />
    </label>
    {canWrite ? <button className={styles.save} type="submit" disabled={busyId !== null}><Save size={14} /> {entry ? "Zapisz" : "Dodaj"}</button> : null}
    {entry && canWrite ? <button className={styles.delete} type="button" aria-label="Usuń wpis" title="Usuń wpis" disabled={busyId !== null} onClick={() => void removeEntry(entry)}><Trash2 size={14} /></button> : null}
  </form>;

  const editor = <div className={styles.inlineWrap}>
    {entries.map((entry) => formFor(entry, String(entry.id ?? Math.random())))}
    {adding ? formFor(undefined, "new") : null}
    {canWrite && entries.length > 0 && !adding ? <button type="button" className={styles.add} onClick={() => { setAdding(true); setMessage(null); setError(null); }}><Plus size={13} /> Dodaj drugi wpis / inną inwestycję</button> : null}
    {!canWrite ? <div className={styles.readOnly}>Widok tylko do odczytu — zapis czasu pracy wymaga uprawnienia do edycji Kadr.</div> : null}
    {message ? <div className={styles.message}>{message}</div> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
  </div>;

  if (variant === "inline") {
    return <div data-hr-inline-timesheet-editor="1">{editor}</div>;
  }

  const summaryProject = projectNames.join(" / ") || "Brak wpisu";
  return <>
    <button
      type="button"
      className={`${styles.cellButton} ${entries.length ? "" : styles.emptyCell}`}
      onClick={() => { setOpen(true); setAdding(entries.length === 0); setMessage(null); setError(null); }}
      title={entries.length ? `${summaryProject} · ${num(total)} h — kliknij, aby edytować` : "Kliknij, aby dodać inwestycję i godziny"}
      aria-label={`${employeeName ?? "Pracownik"}, ${workDate}: ${entries.length ? `${num(total)} godzin` : "brak wpisu"}. Edytuj.`}
    >
      <strong>{entries.length ? `${num(total)} h` : "+ wpis"}</strong>
      <span>{summaryProject}</span>
    </button>
    {open && typeof document !== "undefined" ? createPortal(
      <div className={styles.layer}>
        <button type="button" className={styles.backdrop} onClick={() => setOpen(false)} aria-label="Zamknij edycję czasu pracy" />
        <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Edycja czasu pracy">
          <header className={styles.modalHeader}>
            <div>
              <p>{dayLabel(workDate)}</p>
              <h3>{employeeName ?? "Pracownik"} — inwestycja i godziny</h3>
            </div>
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Zamknij"><X size={17} /></button>
          </header>
          <div className={styles.modalBody}>
            <div className={styles.inlineStatus}><b>{entries.length ? `${entries.length} wpis${entries.length === 1 ? "" : "y"}` : "Brak wpisu"}</b><span>Możesz zmienić inwestycję, godziny i nadgodziny bez tworzenia duplikatu.</span></div>
            {editor}
          </div>
        </section>
      </div>,
      document.body
    ) : null}
  </>;
}
