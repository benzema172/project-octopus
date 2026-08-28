"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Archive,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  X
} from "lucide-react";
import styles from "./hr-employee-registry-152.module.css";

type Row = Record<string, unknown>;

type RegistryData = {
  referenceDate: string;
  employees: Row[];
  projects: Row[];
  employments: Row[];
  assignments: Row[];
};

type CalendarEntry = {
  id: string;
  work_date: string;
  project_id: string | null;
  project_name: string | null;
  hours: number;
  overtime_hours: number;
  status: string;
};

type CalendarResponse = {
  entries?: CalendarEntry[];
  error?: string;
};

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function number(value: unknown, digits = 1) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0);
}

function employeeName(row?: Row) {
  if (!row) return "Pracownik";
  return `${text(row.first_name, "")} ${text(row.last_name, "")}`.trim() || text(row.employee_number);
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function activeOn(row: Row, date: string) {
  return String(row.date_from ?? row.valid_from ?? "0000-01-01") <= date && (!row.date_to && !row.valid_to || String(row.date_to ?? row.valid_to) >= date);
}

function monthLabel(month: string) {
  const parsed = new Date(`${month}-01T12:00:00`);
  return parsed.toLocaleDateString("pl-PL", { month: "long", year: "numeric" });
}

function shiftMonth(month: string, offset: number) {
  const parsed = new Date(`${month}-01T12:00:00Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + offset);
  return parsed.toISOString().slice(0, 7);
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function dateLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function weekdayLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("pl-PL", { weekday: "long" });
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Aktywny",
    inactive: "Archiwum",
    terminated: "Zakończony",
    approved: "Zatwierdzony",
    submitted: "Zgłoszony",
    pending: "Oczekuje",
    draft: "Szkic",
    rejected: "Odrzucony"
  };
  return labels[status] ?? status;
}

function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export function HrEmployeeRegistry152({
  workspaceId,
  data,
  canWrite,
  canManagePayroll
}: {
  workspaceId: string;
  data: RegistryData;
  canWrite: boolean;
  canManagePayroll: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [projectFilter, setProjectFilter] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState<string | null>(null);
  const [calendarEmployeeId, setCalendarEmployeeId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(data.referenceDate.slice(0, 7));
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const employeeById = useMemo(() => new Map(data.employees.map((row) => [String(row.id), row])), [data.employees]);
  const projectById = useMemo(() => new Map(data.projects.map((row) => [String(row.id), row])), [data.projects]);
  const currentEmploymentByEmployee = useMemo(() => {
    const result = new Map<string, Row>();
    for (const row of data.employments) {
      const employeeId = String(row.employee_id);
      if (!result.has(employeeId) && activeOn(row, data.referenceDate)) result.set(employeeId, row);
    }
    return result;
  }, [data.employments, data.referenceDate]);
  const activeAssignmentsByEmployee = useMemo(() => {
    const result = new Map<string, Row[]>();
    for (const row of data.assignments) {
      if (!activeOn(row, data.referenceDate)) continue;
      const employeeId = String(row.employee_id);
      result.set(employeeId, [...(result.get(employeeId) ?? []), row]);
    }
    return result;
  }, [data.assignments, data.referenceDate]);

  const filteredEmployees = useMemo(() => data.employees.filter((employee) => {
    if (statusFilter && String(employee.status) !== statusFilter) return false;
    const employeeId = String(employee.id);
    const assignments = activeAssignmentsByEmployee.get(employeeId) ?? [];
    if (projectFilter && !assignments.some((row) => String(row.project_id) === projectFilter)) return false;
    if (!query.trim()) return true;
    const employment = currentEmploymentByEmployee.get(employeeId);
    const projects = assignments.map((row) => projectById.get(String(row.project_id))?.name ?? "").join(" ");
    return normalize(`${employeeName(employee)} ${employee.employee_number ?? ""} ${employee.email ?? ""} ${employee.phone ?? ""} ${employment?.position ?? ""} ${projects}`).includes(normalize(query));
  }), [activeAssignmentsByEmployee, currentEmploymentByEmployee, data.employees, projectById, projectFilter, query, statusFilter]);

  const editEmployee = editEmployeeId ? employeeById.get(editEmployeeId) ?? null : null;
  const calendarEmployee = calendarEmployeeId ? employeeById.get(calendarEmployeeId) ?? null : null;

  useEffect(() => {
    if (!editEmployeeId && !calendarEmployeeId) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setEditEmployeeId(null);
      setCalendarEmployeeId(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [calendarEmployeeId, editEmployeeId]);

  useEffect(() => {
    if (!calendarEmployeeId) return;
    const controller = new AbortController();
    setCalendarLoading(true);
    setCalendarError(null);
    const params = new URLSearchParams({ workspaceId, employeeId: calendarEmployeeId, month: calendarMonth });
    fetch(`/api/company/hr/employee-calendar?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as CalendarResponse;
        if (!response.ok) throw new Error(payload.error ?? "Nie udało się pobrać kalendarza pracy.");
        setCalendarEntries(payload.entries ?? []);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setCalendarError(reason instanceof Error ? reason.message : "Nie udało się pobrać kalendarza pracy.");
      })
      .finally(() => setCalendarLoading(false));
    return () => controller.abort();
  }, [calendarEmployeeId, calendarMonth, workspaceId]);

  const openCalendar = (employeeId: string) => {
    setCalendarMonth(data.referenceDate.slice(0, 7));
    setCalendarEntries([]);
    setCalendarError(null);
    setCalendarEmployeeId(employeeId);
  };

  const submitEmployee = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editEmployee) return;
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/hr/employee", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, action: "update", payload })
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać pracownika.");
        setMessage("Dane pracownika zostały zapisane.");
        setEditEmployeeId(null);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Nie udało się zapisać pracownika.");
      }
    });
  };

  const changeEmployeeState = (employeeId: string, action: "archive" | "restore" | "delete") => {
    const employee = employeeById.get(employeeId);
    if (!employee) return;
    if (action === "archive" && !window.confirm(`Archiwizować pracownika ${employeeName(employee)}? Dane i historia pozostaną w systemie.`)) return;
    if (action === "restore" && !window.confirm(`Przywrócić pracownika ${employeeName(employee)} do aktywnych?`)) return;
    if (action === "delete" && !window.confirm(`Usunąć trwale pracownika ${employeeName(employee)}? Operacja zadziała tylko, jeżeli pracownik nie ma żadnej historii kadrowej.`)) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/hr/employee", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, action, payload: { employeeId } })
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Nie udało się zmienić statusu pracownika.");
        setMessage(action === "archive" ? "Pracownik został zarchiwizowany." : action === "restore" ? "Pracownik został przywrócony." : "Pracownik został usunięty.");
        setEditEmployeeId(null);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Nie udało się zmienić statusu pracownika.");
      }
    });
  };

  return <>
    <section className={styles.registry} data-hr-enhanced-registry="1">
      <div className={styles.headingRow}>
        <div><p className={styles.kicker}>Kartoteka</p><h2>Pracownicy</h2></div>
        <span className={styles.count}>{filteredEmployees.length}</span>
      </div>
      {message ? <div className={styles.feedback}>{message}</div> : null}
      {error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{error}</div> : null}
      <div className={styles.filters}>
        <div className={styles.searchBox}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Imię, stanowisko, inwestycja, telefon, e-mail…" /></div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Wszystkie statusy</option><option value="active">Aktywni</option><option value="inactive">Archiwum</option><option value="terminated">Zakończone</option></select>
        <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">Wszystkie inwestycje</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th className={styles.lp}>LP.</th><th>Pracownik</th><th>Stanowisko</th><th>Aktualna inwestycja</th><th>Obłożenie</th><th>Kontakt</th><th>Status</th><th className={styles.actionsHead}>Akcje</th></tr></thead>
          <tbody>{filteredEmployees.map((employee, index) => {
            const employeeId = String(employee.id);
            const employment = currentEmploymentByEmployee.get(employeeId);
            const assignments = activeAssignmentsByEmployee.get(employeeId) ?? [];
            const load = assignments.reduce((sum, row) => sum + Number(row.allocation_percent ?? 0), 0);
            return <tr key={employeeId}>
              <td className={styles.lp}>{index + 1}</td>
              <td><button type="button" className={styles.nameButton} onClick={() => setEditEmployeeId(employeeId)}><strong>{employeeName(employee)}</strong></button><div className={styles.subtle}>{text(employee.employee_number)}</div></td>
              <td>{text(employment?.position, "Bez stanowiska")}</td>
              <td>{assignments.map((row) => text(projectById.get(String(row.project_id))?.name)).join(" · ") || "Bez przypisania"}</td>
              <td><div className={styles.load}><progress max="120" value={Math.min(120, load)} /><strong>{number(load, 0)}%</strong></div></td>
              <td>{text(employee.phone)}<div className={styles.subtle}>{text(employee.email)}</div></td>
              <td><span className={`${styles.status} ${String(employee.status) === "active" ? styles.statusActive : styles.statusMuted}`}>{statusLabel(String(employee.status ?? ""))}</span></td>
              <td><div className={styles.rowActions}>
                <button type="button" className={styles.iconButton} onClick={() => setEditEmployeeId(employeeId)} title="Edytuj / archiwizuj pracownika" aria-label={`Edytuj lub archiwizuj ${employeeName(employee)}`}><Pencil size={17} /></button>
                <button type="button" className={styles.iconButton} onClick={() => openCalendar(employeeId)} title="Kalendarz pracy" aria-label={`Kalendarz pracy ${employeeName(employee)}`}><CalendarDays size={17} /></button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
        {!filteredEmployees.length ? <div className={styles.empty}>Brak pracowników dla wybranych filtrów.</div> : null}
      </div>
    </section>

    {editEmployee ? <EmployeeEditModal
      employee={editEmployee}
      employment={currentEmploymentByEmployee.get(String(editEmployee.id))}
      canWrite={canWrite}
      canManagePayroll={canManagePayroll}
      pending={pending}
      error={error}
      close={() => setEditEmployeeId(null)}
      submit={submitEmployee}
      archive={() => changeEmployeeState(String(editEmployee.id), "archive")}
      restore={() => changeEmployeeState(String(editEmployee.id), "restore")}
      remove={() => changeEmployeeState(String(editEmployee.id), "delete")}
    /> : null}

    {calendarEmployee ? <EmployeeCalendarModal
      employee={calendarEmployee}
      month={calendarMonth}
      entries={calendarEntries}
      loading={calendarLoading}
      error={calendarError}
      setMonth={setCalendarMonth}
      close={() => setCalendarEmployeeId(null)}
      referenceMonth={data.referenceDate.slice(0, 7)}
    /> : null}
  </>;
}

function EmployeeEditModal({
  employee,
  employment,
  canWrite,
  canManagePayroll,
  pending,
  error,
  close,
  submit,
  archive,
  restore,
  remove
}: {
  employee: Row;
  employment?: Row;
  canWrite: boolean;
  canManagePayroll: boolean;
  pending: boolean;
  error: string | null;
  close: () => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  archive: () => void;
  restore: () => void;
  remove: () => void;
}) {
  return <ModalPortal><div className={styles.modalLayer}>
    <button className={styles.backdrop} onClick={close} aria-label="Zamknij edycję pracownika" />
    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="employee-edit-title">
      <header className={styles.modalHeader}><div><p className={styles.kicker}>Kartoteka pracownika</p><h2 id="employee-edit-title">{employeeName(employee)}</h2></div><button type="button" className={styles.closeButton} onClick={close} aria-label="Zamknij"><X size={18} /></button></header>
      <div className={styles.modalBody}>
        {error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{error}</div> : null}
        <form className={styles.editForm} onSubmit={submit}>
          <input type="hidden" name="employeeId" value={String(employee.id)} />
          <input type="hidden" name="employmentId" value={employment ? String(employment.id) : ""} />
          <fieldset><legend>Dane pracownika</legend><div className={styles.formGrid}>
            <label>Imię<input name="firstName" defaultValue={text(employee.first_name, "")} required disabled={!canWrite} /></label>
            <label>Nazwisko<input name="lastName" defaultValue={text(employee.last_name, "")} required disabled={!canWrite} /></label>
            <label>Numer pracownika<input name="employeeNumber" defaultValue={text(employee.employee_number, "")} disabled={!canWrite} /></label>
            <label>E-mail<input name="email" type="email" defaultValue={text(employee.email, "")} disabled={!canWrite} /></label>
            <label>Telefon<input name="phone" defaultValue={text(employee.phone, "")} disabled={!canWrite} /></label>
            <label>Kontakt awaryjny<input name="emergencyContactName" defaultValue={text(employee.emergency_contact_name, "")} disabled={!canWrite} /></label>
            <label>Telefon awaryjny<input name="emergencyContactPhone" defaultValue={text(employee.emergency_contact_phone, "")} disabled={!canWrite} /></label>
            <label className={styles.fullWidth}>Notatka<textarea name="notes" defaultValue={text(employee.notes, "")} disabled={!canWrite} /></label>
          </div></fieldset>
          <fieldset><legend>Zatrudnienie</legend><div className={styles.formGrid}>
            <label>Stanowisko<input name="position" defaultValue={text(employment?.position, "")} disabled={!canWrite} /></label>
            <label>Forma zatrudnienia<select name="employmentType" defaultValue={text(employment?.employment_type, "employment_contract")} disabled={!canWrite}><option value="employment_contract">Umowa o pracę</option><option value="contract">Umowa cywilna</option><option value="b2b">B2B</option></select></label>
            <label>Wymiar etatu<input name="fullTimeEquivalent" inputMode="decimal" defaultValue={text(employment?.full_time_equivalent, "1")} disabled={!canWrite} /></label>
          </div></fieldset>
          {canManagePayroll ? <fieldset><legend>Wynagrodzenie i koszt zatrudnienia</legend><div className={styles.formGrid}>
            <label>Wypłata netto<input name="netMonthlyPay" inputMode="decimal" defaultValue={text(employment?.net_monthly_pay, "")} /></label>
            <label>Wynagrodzenie brutto<input name="grossMonthlyPay" inputMode="decimal" defaultValue={text(employment?.gross_monthly_pay, "")} /></label>
            <label>ZUS / składki pracodawcy<input name="employerContributions" inputMode="decimal" defaultValue={text(employment?.employer_contributions, "0")} /></label>
            <label>Pozostałe koszty<input name="otherMonthlyCosts" inputMode="decimal" defaultValue={text(employment?.other_monthly_costs, "0")} /></label>
            <label>Nominalne godziny miesiąca<input name="nominalMonthlyHours" inputMode="decimal" defaultValue={text(employment?.nominal_monthly_hours, "168")} /></label>
          </div></fieldset> : null}
          {canWrite ? <div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={close}>Anuluj</button><button className={styles.primaryButton} disabled={pending}>{pending ? "Zapisywanie…" : "Zapisz zmiany"}</button></div> : null}
        </form>
        {canWrite ? <section className={styles.dangerZone}><div><strong>Zarządzanie kartą</strong><p>Archiwizacja zachowuje pełną historię. Trwałe usunięcie jest dozwolone tylko dla karty bez historii kadrowej.</p></div><div className={styles.dangerActions}>{String(employee.status) === "inactive" ? <button type="button" className={styles.secondaryButton} onClick={restore} disabled={pending}><RotateCcw size={15} /> Przywróć</button> : <button type="button" className={styles.secondaryButton} onClick={archive} disabled={pending}><Archive size={15} /> Archiwizuj</button>}<button type="button" className={styles.dangerButton} onClick={remove} disabled={pending}><Trash2 size={15} /> Usuń trwale</button></div></section> : null}
      </div>
    </section>
  </div></ModalPortal>;
}

function EmployeeCalendarModal({
  employee,
  month,
  entries,
  loading,
  error,
  setMonth,
  close,
  referenceMonth
}: {
  employee: Row;
  month: string;
  entries: CalendarEntry[];
  loading: boolean;
  error: string | null;
  setMonth: (month: string) => void;
  close: () => void;
  referenceMonth: string;
}) {
  const entriesByDay = useMemo(() => {
    const result = new Map<string, CalendarEntry[]>();
    for (const entry of entries) result.set(entry.work_date, [...(result.get(entry.work_date) ?? []), entry]);
    return result;
  }, [entries]);
  const days = Array.from({ length: daysInMonth(month) }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  const totalHours = entries.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
  const overtimeHours = entries.reduce((sum, row) => sum + Number(row.overtime_hours ?? 0), 0);
  const allHours = totalHours + overtimeHours;
  const workedDays = new Set(entries.filter((row) => Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0) > 0).map((row) => row.work_date)).size;

  return <ModalPortal><div className={styles.modalLayer}>
    <button className={styles.backdrop} onClick={close} aria-label="Zamknij kalendarz pracownika" />
    <section className={`${styles.modal} ${styles.calendarModal}`} role="dialog" aria-modal="true" aria-labelledby="employee-calendar-title">
      <header className={styles.modalHeader}><div><p className={styles.kicker}>Kalendarz pracy</p><h2 id="employee-calendar-title">{employeeName(employee)}</h2></div><button type="button" className={styles.closeButton} onClick={close} aria-label="Zamknij"><X size={18} /></button></header>
      <div className={styles.calendarBody}>
        <div className={styles.monthToolbar}>
          <button type="button" className={styles.iconButton} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Poprzedni miesiąc"><ChevronLeft size={18} /></button>
          <div><strong>{monthLabel(month)}</strong><span>{workedDays} dni pracy · {number(totalHours)} h + {number(overtimeHours)} h nadgodzin</span></div>
          <button type="button" className={styles.iconButton} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Następny miesiąc"><ChevronRight size={18} /></button>
          {month !== referenceMonth ? <button type="button" className={styles.todayButton} onClick={() => setMonth(referenceMonth)}>Bieżący miesiąc</button> : null}
        </div>
        {error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{error}</div> : null}
        <div className={styles.calendarTableWrap}>
          <table className={styles.calendarTable}>
            <thead><tr><th>Data</th><th>Dzień</th><th>Inwestycja</th><th>Godziny</th><th>Nadgodziny</th><th>Razem</th><th>Status</th></tr></thead>
            <tbody>{days.map((day) => {
              const dayEntries = entriesByDay.get(day) ?? [];
              const hours = dayEntries.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
              const overtime = dayEntries.reduce((sum, row) => sum + Number(row.overtime_hours ?? 0), 0);
              const weekday = new Date(`${day}T12:00:00`).getDay();
              const projects = dayEntries.map((row) => row.project_name || "Koszt ogólny");
              const statuses = Array.from(new Set(dayEntries.map((row) => statusLabel(row.status))));
              return <tr key={day} className={weekday === 0 || weekday === 6 ? styles.weekend : undefined}>
                <td><strong>{dateLabel(day)}</strong></td><td>{weekdayLabel(day)}</td><td>{projects.length ? projects.join(" · ") : <span className={styles.subtle}>Brak wpisu</span>}</td><td>{dayEntries.length ? `${number(hours)} h` : "—"}</td><td>{dayEntries.length ? `${number(overtime)} h` : "—"}</td><td><strong>{dayEntries.length ? `${number(hours + overtime)} h` : "—"}</strong></td><td>{statuses.length ? statuses.join(" · ") : "—"}</td>
              </tr>;
            })}</tbody>
          </table>
          {loading ? <div className={styles.loading}>Pobieranie ewidencji czasu…</div> : null}
        </div>
        <section className={styles.calendarSummary} aria-label="Podsumowanie czasu pracy w miesiącu">
          <div><span>Godziny podstawowe</span><strong>{number(totalHours)} h</strong></div>
          <div><span>Nadgodziny</span><strong>{number(overtimeHours)} h</strong></div>
          <div className={styles.calendarSummaryTotal}><span>Łącznie w miesiącu</span><strong>{number(allHours)} h</strong></div>
        </section>
      </div>
    </section>
  </div></ModalPortal>;
}
