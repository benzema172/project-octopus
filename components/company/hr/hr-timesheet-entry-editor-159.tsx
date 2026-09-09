"use client";

import { startTransition, useOptimistic, useState, type FormEvent } from "react";
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
  leave?: Row | null;
  onOpenDetails?: () => void;
  onChanged?: () => void;
};

const VACATION_TYPES = new Set(["annual", "on_demand", "unpaid"]);
const VACATION_OPTION = "__vacation__";

function num(value: unknown, digits = 1) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0);
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(Number.isFinite(parsed) ? parsed : 0);
}

function entryHours(row: Row) {
  return Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0);
}

function dayLabel(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return parsed.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function isVacationLeave(leave?: Row | null) {
  return Boolean(leave && String(leave.status ?? "approved") === "approved" && VACATION_TYPES.has(String(leave.leave_type ?? "")));
}

export function HrTimesheetEntryEditor159({ workspaceId, employeeId, employeeName, workDate, projects, entries, canWrite, variant, suggestedProjectId = "", leave = null, onOpenDetails, onChanged }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftKeys, setDraftKeys] = useState<number[]>(() => entries.length === 0 ? [1] : []);
  const [nextDraftKey, setNextDraftKey] = useState(2);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendarLeaveActive, setOptimisticCalendarLeaveActive] = useOptimistic(isVacationLeave(leave));

  const projectById = new Map(projects.map((row) => [String(row.id), String(row.name ?? "Inwestycja")]));
  const total = entries.reduce((sum, row) => sum + entryHours(row), 0);
  const projectNames = Array.from(new Set(entries.map((row) => row.project_id ? projectById.get(String(row.project_id)) ?? "Inwestycja" : "Koszt ogólny")));
  const blockedAbsence = Boolean(leave && String(leave.status ?? "") === "approved" && !isVacationLeave(leave));

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
      const result = await response.json().catch(() => ({})) as { error?: string; laborCostSnapshot?: number | null };
      if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać czasu pracy.");
      if (action === "delete") {
        setMessage("Wpis usunięto. Koszt inwestycji zostanie automatycznie przeliczony.");
      } else {
        const cost = Number(result.laborCostSnapshot ?? 0);
        setMessage(cost > 0
          ? `Zapisano. ${money(cost)} zostało od razu doliczone do kosztu pracy.`
          : "Zapisano. Ewidencja i koszty zostały automatycznie przeliczone.");
      }
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

  const setCalendarVacation = async (nextVacation: boolean) => {
    if (!canWrite || busyId !== null || blockedAbsence) return false;
    if (nextVacation === calendarLeaveActive) return true;
    if (nextVacation && entries.length > 0 && !window.confirm("Ten dzień ma już wpis czasu pracy. Urlop zostanie zapisany, a kalendarz pokaże konflikt danych do wyjaśnienia. Kontynuować?")) return false;
    setBusyId("calendar-leave");
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/company/hr/calendar-leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, employeeId, workDate, action: nextVacation ? "set" : "clear" })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Nie udało się zmienić statusu dnia.");
      startTransition(() => setOptimisticCalendarLeaveActive(nextVacation));
      setMessage(nextVacation
        ? "Urlop zapisany. Wniosek urlopowy został utworzony i zatwierdzony automatycznie."
        : "Urlop z kalendarza usunięty. Dzień jest ponownie dostępny do wpisania pracy.");
      router.refresh();
      onChanged?.();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zmienić statusu dnia.");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const submitEntry = (entry?: Row, draftKey?: number) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const projectId = String(values.projectId ?? "");
    if (projectId === VACATION_OPTION) {
      await setCalendarVacation(true);
      return;
    }
    if (calendarLeaveActive) {
      const cleared = await setCalendarVacation(false);
      if (!cleared) return;
    }
    const id = entry?.id ? String(entry.id) : `new-${draftKey ?? "row"}`;
    const ok = await request(entry?.id ? "update" : "create", entry?.id ? {
      timesheetId: entry.id,
      projectId,
      hours: values.hours,
      overtimeHours: values.overtimeHours
    } : {
      employeeId,
      workDate,
      projectId,
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

  const autoSubmit = (element: HTMLSelectElement | HTMLInputElement) => {
    if (!canWrite || busyId !== null || calendarLeaveActive || blockedAbsence) return;
    const form = element.form;
    if (!form) return;
    queueMicrotask(() => form.requestSubmit());
  };

  const assignmentChange = async (element: HTMLSelectElement, entry?: Row, draftKey?: number) => {
    if (!canWrite || busyId !== null || blockedAbsence) return;
    const projectId = element.value;
    const fallbackProjectId = entry?.project_id ? String(entry.project_id) : suggestedProjectId;
    if (projectId === VACATION_OPTION) {
      const saved = await setCalendarVacation(true);
      if (!saved) element.value = fallbackProjectId;
      return;
    }
    if (!calendarLeaveActive) {
      autoSubmit(element);
      return;
    }
    const cleared = await setCalendarVacation(false);
    if (!cleared) {
      element.value = VACATION_OPTION;
      return;
    }
    const form = element.form;
    if (!form) return;
    const hoursField = form.elements.namedItem("hours");
    const overtimeField = form.elements.namedItem("overtimeHours");
    const hours = hoursField instanceof HTMLInputElement ? hoursField.value : entry ? String(entry.hours ?? "") : "8";
    const overtimeHours = overtimeField instanceof HTMLInputElement ? overtimeField.value : entry ? String(entry.overtime_hours ?? 0) : "0";
    const id = entry?.id ? String(entry.id) : `new-${draftKey ?? "row"}`;
    const ok = await request(entry?.id ? "update" : "create", entry?.id ? {
      timesheetId: entry.id,
      projectId,
      hours,
      overtimeHours
    } : {
      employeeId,
      workDate,
      projectId,
      hours,
      overtimeHours
    }, id);
    if (ok && !entry?.id && draftKey !== undefined) {
      setDraftKeys((current) => current.filter((value) => value !== draftKey));
    }
  };

  const formFor = (entry?: Row, key = "new", draftKey?: number, showAdd = false) => {
    const defaultProjectId = calendarLeaveActive && !entry ? VACATION_OPTION : entry?.project_id ? String(entry.project_id) : suggestedProjectId;
    return <form className={styles.entryRow} onSubmit={submitEntry(entry, draftKey)} key={key}>
      <label className={styles.field}>
        <span>Inwestycja / status</span>
        <select
          name="projectId"
          defaultValue={defaultProjectId}
          disabled={!canWrite || busyId !== null || blockedAbsence}
          onChange={(event) => void assignmentChange(event.currentTarget, entry, draftKey)}
          title="Wybierz inwestycję, koszt ogólny albo Urlop — zmiana zapisuje się automatycznie"
        >
          <option value={VACATION_OPTION}>URLOP</option>
          <option value="">Koszt ogólny / bez inwestycji</option>
          {projects.map((project) => <option value={String(project.id)} key={String(project.id)}>{String(project.name ?? "Inwestycja")}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span>Godziny</span>
        <input
          name="hours"
          inputMode="decimal"
          defaultValue={entry ? String(entry.hours ?? "") : "8"}
          required
          disabled={!canWrite || busyId !== null || calendarLeaveActive || blockedAbsence}
          onBlur={(event) => entry ? autoSubmit(event.currentTarget) : undefined}
        />
      </label>
      <label className={styles.field}>
        <span>Nadg.</span>
        <input
          name="overtimeHours"
          inputMode="decimal"
          defaultValue={entry ? String(entry.overtime_hours ?? 0) : "0"}
          disabled={!canWrite || busyId !== null || calendarLeaveActive || blockedAbsence}
          onBlur={(event) => entry ? autoSubmit(event.currentTarget) : undefined}
        />
      </label>
      {canWrite ? <button className={styles.save} type="submit" disabled={busyId !== null || calendarLeaveActive || blockedAbsence} aria-label={entry ? "Zapisz wpis czasu" : "Dodaj wpis czasu"} title="Zapisz"><Save size={14} /> {variant === "inline" ? null : entry ? "Zapisz" : "Dodaj"}</button> : null}
      {entry && canWrite ? <button className={styles.delete} type="button" aria-label="Usuń wpis" title="Usuń wpis" disabled={busyId !== null} onClick={() => void removeEntry(entry)}><Trash2 size={14} /></button> : null}
      {!entry && canWrite && draftKey !== undefined ? <button className={styles.delete} type="button" aria-label="Usuń nowy wiersz" title="Usuń nowy wiersz" disabled={busyId !== null} onClick={() => removeDraft(draftKey)}><X size={14} /></button> : null}
      {showAdd && canWrite ? <button type="button" className={styles.addEntry} disabled={busyId !== null || calendarLeaveActive || blockedAbsence} onClick={addDraft} aria-label="Dodaj kolejny wpis" title="Dodaj kolejny wpis"><Plus size={14} /></button> : null}
    </form>;
  };

  const lastEntryIndex = draftKeys.length === 0 ? entries.length - 1 : -1;
  const lastDraftIndex = draftKeys.length - 1;
  const showTimeForms = !blockedAbsence;
  const editor = <div className={`${styles.inlineWrap} ${variant === "inline" ? styles.inlineCompact : ""}`}>
    {showTimeForms ? <>{entries.map((entry, index) => formFor(entry, String(entry.id ?? `${employeeId}-${workDate}-${index}`), undefined, index === lastEntryIndex))}{draftKeys.map((draftKey, index) => formFor(undefined, `draft-${draftKey}`, draftKey, index === lastDraftIndex))}</> : <div className={styles.leaveNotice}>Brak wpisu czasu — ten dzień jest oznaczony jako nieobecność. Zmianę wykonaj w zakładce Urlopy i absencje.</div>}
    {!canWrite ? <div className={styles.readOnly}>Widok tylko do odczytu — zmiana ewidencji wymaga uprawnienia do zapisu Kadr.</div> : null}
    {message ? <div className={styles.message}>{message}</div> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
  </div>;

  if (variant === "inline") {
    return <div data-hr-inline-timesheet-editor="1" data-auto-final-timesheet="1" data-unified-vacation-select="1">{editor}</div>;
  }

  const summaryProject = calendarLeaveActive ? "Urlop" : projectNames.join(" / ") || "Brak wpisu";
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
  const hasDayValue = calendarLeaveActive || entries.length > 0;

  return <>
    <button
      type="button"
      className={`${styles.cellButton} ${hasDayValue ? "" : styles.emptyCell}`}
      onClick={openCell}
      title={calendarLeaveActive ? "Urlop — kliknij, aby zmienić przypisanie dnia" : entries.length ? `${summaryProject} · ${num(total)} h — kliknij, aby edytować pełne szczegóły dnia` : "Kliknij, aby wybrać inwestycję, koszt ogólny lub Urlop"}
      aria-label={`${employeeName ?? "Pracownik"}, ${workDate}: ${calendarLeaveActive ? "urlop" : entries.length ? `${num(total)} godzin` : "brak wpisu"}. Otwórz pełne szczegóły dnia.`}
    >
      <strong>{calendarLeaveActive ? "Urlop" : entries.length ? `${num(total)} h` : "+ wpis"}</strong>
      <span>{summaryProject}</span>
    </button>
    {open && typeof document !== "undefined" ? createPortal(
      <div className={styles.layer}>
        <button type="button" className={styles.backdrop} onClick={() => setOpen(false)} aria-label="Zamknij edycję czasu pracy" />
        <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Edycja czasu pracy">
          <header className={styles.modalHeader}>
            <div>
              <p>{dayLabel(workDate)}</p>
              <h3>{employeeName ?? "Pracownik"} — przypisanie dnia</h3>
            </div>
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Zamknij"><X size={17} /></button>
          </header>
          <div className={styles.modalBody}>
            <div className={styles.inlineStatus}><b>{calendarLeaveActive ? "Urlop" : entries.length ? `${entries.length} wpis${entries.length === 1 ? "" : "y"}` : "Brak zapisanego wpisu"}</b><span>W jednym polu wybierz inwestycję, koszt ogólny albo URLOP. Zmiana aktualizuje kalendarz, wnioski urlopowe i koszty automatycznie.</span></div>
            {editor}
          </div>
        </section>
      </div>,
      document.body
    ) : null}
  </>;
}
