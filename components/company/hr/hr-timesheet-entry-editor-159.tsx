"use client";

import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleX, Plus, Save, Trash2, X } from "lucide-react";
import { useHrApproval } from "./hr-approval-context-420";
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
  onOpenDetails?: () => void;
  onChanged?: () => void;
};

type Decision = "approved" | "rejected";

const PENDING_STATUSES = new Set(["draft", "pending", "submitted", "review"]);

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

function approvalLabel(value: unknown) {
  const status = String(value ?? "submitted");
  if (status === "approved") return "Zatwierdzony";
  if (status === "rejected") return "Odrzucony";
  if (status === "review") return "Weryfikacja";
  if (status === "draft" || status === "pending" || status === "submitted") return "Do zatwierdzenia";
  return status || "Do zatwierdzenia";
}

function approvalClass(value: unknown) {
  const status = String(value ?? "submitted");
  if (status === "approved") return styles.approvalApproved;
  if (status === "rejected") return styles.approvalRejected;
  return styles.approvalPending;
}

export function HrTimesheetEntryEditor159({ workspaceId, employeeId, employeeName, workDate, projects, entries, canWrite, variant, suggestedProjectId = "", onOpenDetails, onChanged }: Props) {
  const router = useRouter();
  const canApprove = useHrApproval();
  const [open, setOpen] = useState(false);
  const [draftKeys, setDraftKeys] = useState<number[]>(() => entries.length === 0 ? [1] : []);
  const [nextDraftKey, setNextDraftKey] = useState(2);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectById = new Map(projects.map((row) => [String(row.id), String(row.name ?? "Inwestycja")]));
  const total = entries.reduce((sum, row) => sum + entryHours(row), 0);
  const projectNames = Array.from(new Set(entries.map((row) => row.project_id ? projectById.get(String(row.project_id)) ?? "Inwestycja" : "Koszt ogólny")));
  const pendingEntries = entries.filter((row) => String(row.status ?? "submitted") !== "approved");

  const request = async (action: "create" | "update" | "delete", payload: Record<string, unknown>, busyKey: string) => {
    if (!canWrite || !workspaceId) return false;
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
      setMessage(action === "delete" ? "Wpis usunięto." : action === "create" ? "Wpis dodano — oczekuje na zatwierdzenie." : "Zmiany zapisano — wpis oczekuje na zatwierdzenie.");
      router.refresh();
      onChanged?.();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać czasu pracy.");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const decideEntries = async (ids: string[], decision: Decision, busyKey: string) => {
    if (!canApprove || !workspaceId || !ids.length) return false;
    setBusyId(busyKey);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/company/hr/timesheet-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, timesheetIds: ids, decision })
      });
      const result = await response.json().catch(() => ({})) as { error?: string; affected?: number; approvedCost?: number };
      if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać decyzji o czasie pracy.");
      const affected = Number(result.affected ?? ids.length);
      const cost = Number(result.approvedCost ?? 0);
      setMessage(decision === "approved"
        ? `Zatwierdzono ${affected} ${affected === 1 ? "wpis" : "wpisy"}. Koszt ${cost > 0 ? `${new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(cost)} ` : ""}został przekazany do kontroli inwestycji.`
        : `Odrzucono ${affected} ${affected === 1 ? "wpis" : "wpisy"}.`);
      router.refresh();
      onChanged?.();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać decyzji o czasie pracy.");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const submitEntry = (entry?: Row, draftKey?: number) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const id = entry?.id ? String(entry.id) : `new-${draftKey ?? "row"}`;
    const ok = await request(entry?.id ? "update" : "create", entry?.id ? {
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
    if (ok && !entry?.id && draftKey !== undefined) {
      setDraftKeys((current) => current.filter((value) => value !== draftKey));
    }
  };

  const removeEntry = async (entry: Row) => {
    if (!entry.id || !canWrite) return;
    if (!window.confirm("Usunąć ten wpis czasu pracy?")) return;
    await request("delete", { timesheetId: entry.id }, String(entry.id));
  };

  const addDraft = () => {
    setDraftKeys((current) => [...current, nextDraftKey]);
    setNextDraftKey((value) => value + 1);
    setMessage(null);
    setError(null);
  };

  const removeDraft = (draftKey: number) => {
    setDraftKeys((current) => current.filter((value) => value !== draftKey));
    setMessage(null);
    setError(null);
  };

  const formFor = (entry?: Row, key = "new", draftKey?: number, showAdd = false) => {
    const entryId = entry?.id ? String(entry.id) : null;
    const entryStatus = String(entry?.status ?? "submitted");
    return <form className={styles.entryRow} onSubmit={submitEntry(entry, draftKey)} key={key}>
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
      {entry ? <span className={`${styles.approvalStatus} ${approvalClass(entryStatus)}`} title={`Status ewidencji: ${approvalLabel(entryStatus)}`}>{approvalLabel(entryStatus)}</span> : <span className={`${styles.approvalStatus} ${styles.approvalDraft}`}>Nowy wpis</span>}
      {canWrite ? <button className={styles.save} type="submit" disabled={busyId !== null} aria-label={entry ? "Zapisz wpis czasu" : "Dodaj wpis czasu"} title={entry && entryStatus === "approved" ? "Zapisz — wpis wróci do zatwierdzenia" : entry ? "Zapisz" : "Dodaj wpis"}><Save size={14} /> {variant === "inline" ? null : entry ? "Zapisz" : "Dodaj"}</button> : null}
      {entry && canApprove ? <span className={styles.decisionGroup}>
        {entryStatus !== "approved" ? <button type="button" className={styles.approve} disabled={busyId !== null} onClick={() => void decideEntries([entryId!], "approved", `approve-${entryId}`)} aria-label="Zatwierdź wpis" title="Zatwierdź wpis i przekaż koszt do inwestycji"><CheckCircle2 size={14} /></button> : null}
        {entryStatus !== "rejected" ? <button type="button" className={styles.reject} disabled={busyId !== null} onClick={() => void decideEntries([entryId!], "rejected", `reject-${entryId}`)} aria-label="Odrzuć wpis" title="Odrzuć wpis"><CircleX size={14} /></button> : null}
      </span> : null}
      {entry && canWrite ? <button className={styles.delete} type="button" aria-label="Usuń wpis" title="Usuń wpis" disabled={busyId !== null} onClick={() => void removeEntry(entry)}><Trash2 size={14} /></button> : null}
      {!entry && canWrite && draftKey !== undefined ? <button className={styles.delete} type="button" aria-label="Usuń nowy wiersz" title="Usuń nowy wiersz" disabled={busyId !== null} onClick={() => removeDraft(draftKey)}><X size={14} /></button> : null}
      {showAdd && canWrite ? <button type="button" className={styles.addEntry} disabled={busyId !== null} onClick={addDraft} aria-label="Dodaj kolejny wpis" title="Dodaj kolejny wpis"><Plus size={14} /></button> : null}
    </form>;
  };

  const lastEntryIndex = draftKeys.length === 0 ? entries.length - 1 : -1;
  const lastDraftIndex = draftKeys.length - 1;
  const editor = <div className={`${styles.inlineWrap} ${variant === "inline" ? styles.inlineCompact : ""}`}>
    {canApprove && entries.length > 1 && pendingEntries.length > 0 ? <div className={styles.dayDecisionBar}>
      <span>{pendingEntries.length} {pendingEntries.length === 1 ? "wpis czeka" : "wpisy czekają"} na decyzję</span>
      <button type="button" disabled={busyId !== null} onClick={() => void decideEntries(pendingEntries.map((row) => String(row.id)), "approved", "approve-day")}><CheckCircle2 size={13} /> Zatwierdź cały dzień</button>
    </div> : null}
    {entries.map((entry, index) => formFor(entry, String(entry.id ?? `${employeeId}-${workDate}-${index}`), undefined, index === lastEntryIndex))}
    {draftKeys.map((draftKey, index) => formFor(undefined, `draft-${draftKey}`, draftKey, index === lastDraftIndex))}
    {!canWrite && !canApprove ? <div className={styles.readOnly}>Widok tylko do odczytu — zapis i decyzje wymagają odpowiednich uprawnień Kadr.</div> : null}
    {message ? <div className={styles.message}>{message}</div> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
  </div>;

  if (variant === "inline") {
    return <div data-hr-inline-timesheet-editor="1">{editor}</div>;
  }

  const summaryProject = projectNames.join(" / ") || "Brak wpisu";
  const openCell = () => {
    setMessage(null);
    setError(null);
    if (onOpenDetails) {
      onOpenDetails();
      return;
    }
    setOpen(true);
    if (!entries.length && !draftKeys.length) setDraftKeys([nextDraftKey]);
  };

  return <>
    <button
      type="button"
      className={`${styles.cellButton} ${entries.length ? "" : styles.emptyCell}`}
      onClick={openCell}
      title={entries.length ? `${summaryProject} · ${num(total)} h — kliknij, aby edytować pełne szczegóły dnia` : "Kliknij, aby dodać inwestycję, godziny i szczegóły pracy"}
      aria-label={`${employeeName ?? "Pracownik"}, ${workDate}: ${entries.length ? `${num(total)} godzin` : "brak wpisu"}. Otwórz pełne szczegóły dnia.`}
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
            <div className={styles.inlineStatus}><b>{entries.length ? `${entries.length} wpis${entries.length === 1 ? "" : "y"}` : "Brak zapisanego wpisu"}</b><span>Każdy wpis możesz niezależnie zapisać, usunąć albo dodać kolejną inwestycję tego samego dnia.</span></div>
            {editor}
          </div>
        </section>
      </div>,
      document.body
    ) : null}
  </>;
}
