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
  qualifications?: Row[];
  exams?: Row[];
  trainings?: Row[];
  entitlements?: Row[];
  auditEvents?: Row[];
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

type ApiResponse = {
  id?: string;
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

function safeDateLabel(value: unknown) {
  const raw = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "brak terminu";
  return dateLabel(raw);
}

function auditDateLabel(value: unknown) {
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? "brak daty" : parsed.toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" });
}

function auditEventLabel(value: unknown) {
  const key = String(value ?? "").replace(/^hr\./, "");
  const labels: Record<string, string> = {
    employee_created: "Utworzono kartę pracownika",
    employee_updated: "Zmieniono dane pracownika",
    employee_managed: "Zmieniono dane lub zatrudnienie",
    employee_status: "Zmieniono status pracownika",
    employee_archived: "Zarchiwizowano pracownika",
    employee_restored: "Przywrócono pracownika",
    employment_created: "Dodano warunki zatrudnienia",
    leave_entitlement_upserted: "Zmieniono limit urlopowy",
    qualification_created: "Dodano uprawnienie",
    medical_exam_created: "Dodano badanie lekarskie",
    safety_training_created: "Dodano szkolenie BHP"
  };
  return labels[key] ?? (key.replaceAll("_", " ") || "Zmiana kadrowa");
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

function latestEmployeeRecord(rows: Row[] | undefined, employeeId: string, dateKeys: string[]) {
  return (rows ?? [])
    .filter((row) => String(row.employee_id) === employeeId)
    .sort((a, b) => {
      const dateValue = (row: Row) => dateKeys.map((key) => String(row[key] ?? "")).find(Boolean) ?? "";
      return dateValue(b).localeCompare(dateValue(a));
    })[0];
}

function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export function HrEmployeeRegistry152({
  workspaceId,
  data,
  canWrite,
  canApprove,
  canManagePayroll
}: {
  workspaceId: string;
  data: RegistryData;
  canWrite: boolean;
  canApprove: boolean;
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
  const referenceYear = Number(data.referenceDate.slice(0, 4));

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
  const editEmployeeKey = editEmployee ? String(editEmployee.id) : "";
  const currentExam = editEmployeeKey ? latestEmployeeRecord(data.exams, editEmployeeKey, ["examined_at", "valid_until", "created_at"]) : undefined;
  const currentTraining = editEmployeeKey ? latestEmployeeRecord(data.trainings, editEmployeeKey, ["completed_at", "valid_until", "created_at"]) : undefined;
  const currentEntitlement = editEmployeeKey ? (data.entitlements ?? []).find((row) => String(row.employee_id) === editEmployeeKey && Number(row.year) === referenceYear) : undefined;
  const employeeQualifications = editEmployeeKey ? (data.qualifications ?? [])
    .filter((row) => String(row.employee_id) === editEmployeeKey)
    .sort((a, b) => String(b.valid_until ?? b.issued_at ?? b.created_at ?? "").localeCompare(String(a.valid_until ?? a.issued_at ?? a.created_at ?? ""))) : [];
  const employeeAuditEvents = editEmployeeKey ? (data.auditEvents ?? [])
    .filter((row) => String(row.entity_type) === "employee" && String(row.entity_id) === editEmployeeKey)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, 10) : [];

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

  const postHrAction = async (action: "medical_exam_create" | "safety_training_create" | "qualification_create" | "leave_entitlement_upsert", payload: Record<string, unknown>) => {
    const response = await fetch("/api/company/hr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, action, payload })
    });
    const result = await response.json().catch(() => ({})) as ApiResponse;
    if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać dodatkowych danych pracownika.");
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
        const result = await response.json().catch(() => ({})) as ApiResponse;
        if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać pracownika.");

        const employeeId = String(payload.employeeId ?? editEmployee.id);
        const additions: Array<Promise<void>> = [];
        const leaveRequested = Boolean(payload.leaveAnnualDays || payload.leaveCarriedOverDays || payload.leaveExtraDays || payload.leaveNotes);
        if (leaveRequested) {
          if (!payload.leaveAnnualDays) throw new Error("Dni wolne: uzupełnij podstawowy wymiar urlopu, np. 20 lub 26 dni.");
          additions.push(postHrAction("leave_entitlement_upsert", {
            employeeId,
            year: referenceYear,
            annualDays: payload.leaveAnnualDays,
            carriedOverDays: payload.leaveCarriedOverDays,
            extraDays: payload.leaveExtraDays,
            notes: payload.leaveNotes
          }));
        }
        const medicalRequested = Boolean(payload.medicalExamType || payload.medicalExaminedAt || payload.medicalValidUntil);
        if (medicalRequested) {
          if (!payload.medicalExamType || !payload.medicalValidUntil) throw new Error("Badanie lekarskie: uzupełnij rodzaj badania i datę ważności.");
          additions.push(postHrAction("medical_exam_create", {
            employeeId,
            examType: payload.medicalExamType,
            examinedAt: payload.medicalExaminedAt,
            validUntil: payload.medicalValidUntil,
            result: payload.medicalExamResult || "fit"
          }));
        }
        const trainingRequested = Boolean(payload.safetyTrainingType || payload.safetyTrainingProvider || payload.safetyTrainingCompletedAt || payload.safetyTrainingValidUntil);
        if (trainingRequested) {
          if (!payload.safetyTrainingType || !payload.safetyTrainingCompletedAt) throw new Error("Szkolenie BHP: uzupełnij rodzaj i datę ukończenia.");
          additions.push(postHrAction("safety_training_create", {
            employeeId,
            trainingType: payload.safetyTrainingType,
            provider: payload.safetyTrainingProvider,
            completedAt: payload.safetyTrainingCompletedAt,
            validUntil: payload.safetyTrainingValidUntil,
            notes: payload.safetyTrainingNotes
          }));
        }
        const qualificationRequested = Boolean(payload.qualificationType || payload.qualificationNumber || payload.qualificationIssuedAt || payload.qualificationValidUntil);
        if (qualificationRequested) {
          if (!payload.qualificationType) throw new Error("Uprawnienie: uzupełnij rodzaj uprawnienia lub certyfikatu.");
          additions.push(postHrAction("qualification_create", {
            employeeId,
            qualificationType: payload.qualificationType,
            number: payload.qualificationNumber,
            issuedAt: payload.qualificationIssuedAt,
            validUntil: payload.qualificationValidUntil
          }));
        }
        await Promise.all(additions);

        const messages = ["Dane pracownika zostały zapisane."];
        if (leaveRequested) messages.push("Limit dni wolnych zsynchronizowano z „Urlopy i absencje”.");
        const complianceCount = Number(medicalRequested) + Number(trainingRequested) + Number(qualificationRequested);
        if (complianceCount) messages.push(`Dodano ${complianceCount} wpis${complianceCount === 1 ? "" : "y"} do „Uprawnienia i BHP”.`);
        setMessage(messages.join(" "));
        setEditEmployeeId(null);
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Nie udało się zapisać pracownika.");
      }
    });
  };

  const changeEmployeeState = (employeeId: string, action: "archive" | "restore" | "delete" | "force_delete") => {
    const employee = employeeById.get(employeeId);
    if (!employee) return;
    if (action === "archive" && !window.confirm(`Archiwizować pracownika ${employeeName(employee)}? Dane i historia pozostaną w systemie.`)) return;
    if (action === "restore" && !window.confirm(`Przywrócić pracownika ${employeeName(employee)} do aktywnych?`)) return;
    if (action === "delete" && !window.confirm(`Usunąć trwale pracownika ${employeeName(employee)}? Operacja zadziała tylko, jeżeli pracownik nie ma żadnej historii kadrowej.`)) return;
    if (action === "force_delete") {
      if (!canApprove) {
        window.alert("Trwałe usunięcie pracownika wraz z historią wymaga uprawnienia do zatwierdzania w Kadrach.");
        return;
      }
      if (!window.confirm(`Trwale usunąć ${employeeName(employee)}?\n\nZostanie usunięta karta pracownika oraz powiązana historia HR. Ta operacja służy m.in. do wyzerowania danych testowych i jest nieodwracalna.`)) return;
      const phrase = window.prompt("Aby potwierdzić świadome trwałe usunięcie, wpisz dokładnie: USUŃ");
      if (phrase?.trim() !== "USUŃ") {
        window.alert("Usuwanie anulowane — nie wpisano poprawnego hasła potwierdzającego.");
        return;
      }
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const payload = action === "force_delete"
          ? { employeeId, confirmation: "USUŃ", reason: "manual_test_reset" }
          : { employeeId };
        const response = await fetch("/api/company/hr/employee", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, action, payload })
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Nie udało się zmienić statusu pracownika.");
        setMessage(action === "archive" ? "Pracownik został zarchiwizowany." : action === "restore" ? "Pracownik został przywrócony." : action === "force_delete" ? "Pracownik i powiązana historia HR zostały trwale usunięte." : "Pracownik został usunięty.");
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
          <thead><tr><th className={styles.lp}>LP.</th><th>Pracownik</th><th>Stanowisko</th><th>Obłożenie</th><th>Kontakt</th><th>Status</th><th className={styles.actionsHead}>Akcje</th></tr></thead>
          <tbody>{filteredEmployees.map((employee, index) => {
            const employeeId = String(employee.id);
            const employment = currentEmploymentByEmployee.get(employeeId);
            const assignments = activeAssignmentsByEmployee.get(employeeId) ?? [];
            const load = assignments.reduce((sum, row) => sum + Number(row.allocation_percent ?? 0), 0);
            return <tr key={employeeId}>
              <td className={styles.lp}>{index + 1}</td>
              <td><button type="button" className={styles.nameButton} onClick={() => setEditEmployeeId(employeeId)}><strong>{employeeName(employee)}</strong></button><div className={styles.subtle}>{text(employee.employee_number)}</div></td>
              <td>{text(employment?.position, "Bez stanowiska")}</td>
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
      currentExam={currentExam}
      currentTraining={currentTraining}
      currentEntitlement={currentEntitlement}
      referenceYear={referenceYear}
      qualifications={employeeQualifications}
      history={employeeAuditEvents}
      canWrite={canWrite}
      canManagePayroll={canManagePayroll}
      pending={pending}
      error={error}
      close={() => setEditEmployeeId(null)}
      submit={submitEmployee}
      archive={() => changeEmployeeState(String(editEmployee.id), "archive")}
      restore={() => changeEmployeeState(String(editEmployee.id), "restore")}
      remove={() => changeEmployeeState(String(editEmployee.id), canApprove ? "force_delete" : "delete")}
      canApprove={canApprove}
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
  currentExam,
  currentTraining,
  currentEntitlement,
  referenceYear,
  qualifications,
  history,
  canWrite,
  canManagePayroll,
  canApprove,
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
  currentExam?: Row;
  currentTraining?: Row;
  currentEntitlement?: Row;
  referenceYear: number;
  qualifications: Row[];
  history: Row[];
  canWrite: boolean;
  canManagePayroll: boolean;
  canApprove: boolean;
  pending: boolean;
  error: string | null;
  close: () => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  archive: () => void;
  restore: () => void;
  remove: () => void;
}) {
  const qualificationSummary = qualifications.length
    ? qualifications.slice(0, 4).map((row) => `${text(row.qualification_type)}${row.valid_until ? ` (do ${safeDateLabel(row.valid_until)})` : ""}`).join(" · ")
    : "brak zapisanych uprawnień";
  const leaveTotal = currentEntitlement
    ? Number(currentEntitlement.annual_days ?? 0) + Number(currentEntitlement.carried_over_days ?? 0) + Number(currentEntitlement.extra_days ?? 0)
    : null;

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
          <fieldset><legend>Dni wolne i urlop</legend><div className={styles.formGrid}>
            <div className={styles.fullWidth}>
              <strong>Limit na {referenceYear} r.</strong>
              <div className={styles.subtle}>{leaveTotal === null ? "Brak zapisanego limitu dla tego roku — system nie zakłada automatycznie 26 dni." : `Łącznie zapisano ${number(leaveTotal, 0)} dni. Zmiany w tym miejscu aktualizują tę samą ewidencję co zakładka „Urlopy i absencje”.`}</div>
            </div>
            <label>Urlop podstawowy — dni<input name="leaveAnnualDays" inputMode="decimal" placeholder="np. 20 lub 26" defaultValue={text(currentEntitlement?.annual_days, "")} disabled={!canWrite} /></label>
            <label>Dni przeniesione z poprzedniego roku<input name="leaveCarriedOverDays" inputMode="decimal" placeholder="0" defaultValue={text(currentEntitlement?.carried_over_days, "")} disabled={!canWrite} /></label>
            <label>Dni dodatkowe<input name="leaveExtraDays" inputMode="decimal" placeholder="0" defaultValue={text(currentEntitlement?.extra_days, "")} disabled={!canWrite} /></label>
            <label>Uwagi do limitu<input name="leaveNotes" defaultValue={text(currentEntitlement?.notes, "")} placeholder="Opcjonalnie" disabled={!canWrite} /></label>
          </div></fieldset>
          <fieldset><legend>Badania, BHP i uprawnienia</legend><div className={styles.formGrid}>
            <div className={styles.fullWidth}>
              <strong>Aktualna ewidencja</strong>
              <div className={styles.subtle}>Badanie: {currentExam ? `${text(currentExam.exam_type)} · ważne do ${safeDateLabel(currentExam.valid_until)}` : "brak"}</div>
              <div className={styles.subtle}>BHP: {currentTraining ? `${text(currentTraining.training_type)} · ukończono ${safeDateLabel(currentTraining.completed_at)}${currentTraining.valid_until ? ` · ważne do ${safeDateLabel(currentTraining.valid_until)}` : ""}` : "brak"}</div>
              <div className={styles.subtle}>Uprawnienia: {qualificationSummary}</div>
              <div className={styles.subtle}>Poniższe pola dodają nowy wpis do historii. Po zapisie dane pojawią się również w zakładce „Uprawnienia i BHP”.</div>
            </div>
            <label>Nowe badanie lekarskie<select name="medicalExamType" defaultValue="" disabled={!canWrite}><option value="">Nie dodawaj</option><option value="Wstępne">Wstępne</option><option value="Okresowe">Okresowe</option><option value="Kontrolne">Kontrolne</option></select></label>
            <label>Wynik badania<select name="medicalExamResult" defaultValue="fit" disabled={!canWrite}><option value="fit">Zdolny</option><option value="fit_with_restrictions">Zdolny z ograniczeniami</option><option value="unfit">Niezdolny</option></select></label>
            <label>Data badania<input name="medicalExaminedAt" type="date" disabled={!canWrite} /></label>
            <label>Badanie ważne do<input name="medicalValidUntil" type="date" disabled={!canWrite} /></label>
            <label>Nowe szkolenie BHP<select name="safetyTrainingType" defaultValue="" disabled={!canWrite}><option value="">Nie dodawaj</option><option value="Wstępne">Wstępne</option><option value="Okresowe">Okresowe</option><option value="Instruktaż stanowiskowy">Instruktaż stanowiskowy</option></select></label>
            <label>Organizator BHP<input name="safetyTrainingProvider" placeholder="Firma / osoba prowadząca" disabled={!canWrite} /></label>
            <label>Ukończono BHP<input name="safetyTrainingCompletedAt" type="date" disabled={!canWrite} /></label>
            <label>BHP ważne do<input name="safetyTrainingValidUntil" type="date" disabled={!canWrite} /></label>
            <label className={styles.fullWidth}>Uwagi do szkolenia BHP<input name="safetyTrainingNotes" placeholder="Opcjonalnie" disabled={!canWrite} /></label>
            <label>Nowe uprawnienie / certyfikat<input name="qualificationType" placeholder="SEP, UDT, F-Gazy, prawo jazdy…" disabled={!canWrite} /></label>
            <label>Numer uprawnienia<input name="qualificationNumber" disabled={!canWrite} /></label>
            <label>Wydano<input name="qualificationIssuedAt" type="date" disabled={!canWrite} /></label>
            <label>Ważne do<input name="qualificationValidUntil" type="date" disabled={!canWrite} /></label>
          </div></fieldset>
          {canManagePayroll ? <fieldset><legend>Wynagrodzenie i koszt zatrudnienia</legend><div className={styles.formGrid}>
            <label>Wypłata netto<input name="netMonthlyPay" inputMode="decimal" defaultValue={text(employment?.net_monthly_pay, "")} /></label>
            <label>Wynagrodzenie brutto<input name="grossMonthlyPay" inputMode="decimal" defaultValue={text(employment?.gross_monthly_pay, "")} /></label>
            <label>ZUS / składki pracodawcy<input name="employerContributions" inputMode="decimal" defaultValue={text(employment?.employer_contributions, "0")} /></label>
            <label>Pozostałe koszty<input name="otherMonthlyCosts" inputMode="decimal" defaultValue={text(employment?.other_monthly_costs, "0")} /></label>
            <label>Nominalne godziny miesiąca<input name="nominalMonthlyHours" inputMode="decimal" defaultValue={text(employment?.nominal_monthly_hours, "168")} /></label>
          </div></fieldset> : null}
          <fieldset><legend>Historia zmian</legend><div className={styles.fullWidth}>
            {history.length ? history.map((row) => <div key={String(row.id)}><strong>{auditEventLabel(row.event_type)}</strong><div className={styles.subtle}>{auditDateLabel(row.created_at)} · {String(row.actor_type ?? "user") === "user" ? "użytkownik" : text(row.actor_type)}</div></div>) : <div className={styles.subtle}>Brak zapisanych zdarzeń audytowych dla tej karty.</div>}
          </div></fieldset>
          {canWrite ? <div className={styles.modalActions}><button type="button" className={styles.secondaryButton} onClick={close}>Anuluj</button><button className={styles.primaryButton} disabled={pending}>{pending ? "Zapisywanie…" : "Zapisz zmiany"}</button></div> : null}
        </form>
        {canWrite ? <section className={styles.dangerZone}><div><strong>Zarządzanie kartą</strong><p>{canApprove ? "Archiwizacja zachowuje pełną historię. Trwałe usunięcie kasuje kartę i powiązaną historię HR; wymaga dodatkowego potwierdzenia hasłem USUŃ." : "Archiwizacja zachowuje pełną historię. Trwałe usunięcie wraz z historią jest dostępne tylko dla osoby z uprawnieniem do zatwierdzania w Kadrach."}</p></div><div className={styles.dangerActions}>{String(employee.status) === "inactive" ? <button type="button" className={styles.secondaryButton} onClick={restore} disabled={pending}><RotateCcw size={15} /> Przywróć</button> : <button type="button" className={styles.secondaryButton} onClick={archive} disabled={pending}><Archive size={15} /> Archiwizuj</button>}<button type="button" className={styles.dangerButton} onClick={remove} disabled={pending} title={canApprove ? "Usuń pracownika razem z historią po dodatkowym potwierdzeniu" : "Trwałe usunięcie wymaga uprawnienia do zatwierdzania w Kadrach"}><Trash2 size={15} /> Usuń trwale</button></div></section> : null}
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
