"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Archive, CalendarDays, Pencil, RotateCcw, Search, Trash2, X } from "lucide-react";
import { buildHrEmployeeIssues } from "@/lib/hr/employee-issues";
import type { HrRow, HrWorkspaceData } from "@/lib/hr/types";
import { HrCompensationFields150 } from "./hr-compensation-fields-150";
import styles from "./hr-employee-registry-152.module.css";
import core from "./hr-core-300.module.css";

function text(value: unknown, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function employeeName(row?: HrRow) { return row ? `${text(row.first_name, "")} ${text(row.last_name, "")}`.trim() || text(row.employee_number) : "Pracownik"; }
function normalize(value: unknown) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").toLowerCase(); }
function activeOn(row: HrRow, date: string) { return String(row.date_from ?? row.valid_from ?? "0000-01-01").slice(0, 10) <= date && (!row.date_to && !row.valid_to || String(row.date_to ?? row.valid_to).slice(0, 10) >= date); }
function num(value: unknown, digits = 0) { const parsed = Number(value ?? 0); return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0); }
function dateLabel(value: unknown) { if (!value) return "—"; const raw = String(value).slice(0, 10); const parsed = new Date(`${raw}T00:00:00Z`); return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString("pl-PL", { timeZone: "UTC" }); }

export function HrEmployeeRegistry300({ workspaceId, data, canWrite, canApprove, canViewPayroll, canManagePayroll, onOpenTime }: { workspaceId: string; data: HrWorkspaceData; canWrite: boolean; canApprove: boolean; canViewPayroll: boolean; canManagePayroll: boolean; onOpenTime: (employeeId: string) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [projectFilter, setProjectFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const employeeById = useMemo(() => new Map(data.employees.map((row) => [String(row.id), row])), [data.employees]);
  const currentEmploymentByEmployee = useMemo(() => { const map = new Map<string, HrRow>(); for (const row of data.employments) { const id = String(row.employee_id); if (!map.has(id) && activeOn(row, data.referenceDate)) map.set(id, row); } return map; }, [data.employments, data.referenceDate]);
  const activeAssignmentsByEmployee = useMemo(() => { const map = new Map<string, HrRow[]>(); for (const row of data.assignments.filter((item) => activeOn(item, data.referenceDate))) { const id = String(row.employee_id); map.set(id, [...(map.get(id) ?? []), row]); } return map; }, [data.assignments, data.referenceDate]);
  const projectById = useMemo(() => new Map(data.projects.map((row) => [String(row.id), row])), [data.projects]);
  const issueSummary = useMemo(() => buildHrEmployeeIssues(data, { canViewPayroll }), [canViewPayroll, data]);
  const filtered = useMemo(() => data.employees.filter((employee) => {
    if (statusFilter && String(employee.status) !== statusFilter) return false;
    const id = String(employee.id); const assignments = activeAssignmentsByEmployee.get(id) ?? [];
    if (projectFilter && !assignments.some((row) => String(row.project_id) === projectFilter)) return false;
    if (!query.trim()) return true;
    const employment = currentEmploymentByEmployee.get(id);
    const projects = assignments.map((row) => projectById.get(String(row.project_id))?.name ?? "").join(" ");
    return normalize(`${employeeName(employee)} ${employee.employee_number ?? ""} ${employee.email ?? ""} ${employee.phone ?? ""} ${employment?.position ?? ""} ${projects}`).includes(normalize(query));
  }), [activeAssignmentsByEmployee, currentEmploymentByEmployee, data.employees, projectById, projectFilter, query, statusFilter]);
  const selected = selectedId ? employeeById.get(selectedId) ?? null : null;

  const changeState = (employeeId: string, action: "archive" | "restore" | "delete" | "force_delete") => {
    const employee = employeeById.get(employeeId); if (!employee) return;
    const label = employeeName(employee);
    if (action === "archive" && !window.confirm(`Archiwizować pracownika ${label}?`)) return;
    if (action === "restore" && !window.confirm(`Przywrócić pracownika ${label}?`)) return;
    if (action === "delete" && !window.confirm(`Usunąć trwale ${label}? Operacja zadziała tylko bez historii HR.`)) return;
    if (action === "force_delete") { if (!canApprove) return; if (!window.confirm(`Trwale usunąć ${label} wraz z historią HR?`)) return; if (window.prompt("Wpisz dokładnie: USUŃ")?.trim() !== "USUŃ") return; }
    setError(null); setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/company/hr/employee", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, action, payload: action === "force_delete" ? { employeeId, confirmation: "USUŃ", reason: "manual_reset" } : { employeeId } }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(result.error ?? "Nie udało się zmienić statusu pracownika."); return; }
      setMessage(action === "archive" ? "Pracownik zarchiwizowany." : action === "restore" ? "Pracownik przywrócony." : "Pracownik usunięty."); setSelectedId(null); router.refresh();
    });
  };

  return <>
    <section className={styles.registry} data-hr-core-registry="300">
      <div className={styles.headingRow}><div><p className={styles.kicker}>Kartoteka Core 3.0</p><h2>Pracownicy</h2></div><span className={styles.count}>{filtered.length}</span></div>
      {message ? <div className={styles.feedback}>{message}</div> : null}{error ? <div className={`${styles.feedback} ${styles.feedbackError}`}>{error}</div> : null}
      <div className={styles.filters}><div className={styles.searchBox}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Imię, stanowisko, inwestycja, telefon, e-mail…" /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Wszystkie statusy</option><option value="active">Aktywni</option><option value="inactive">Archiwum</option><option value="terminated">Zakończone</option></select><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">Wszystkie inwestycje</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th className={styles.lp}>LP.</th><th>Pracownik</th><th>Stanowisko</th><th>Obłożenie</th><th>Problemy</th><th>Kontakt</th><th>Status</th><th className={styles.actionsHead}>Akcje</th></tr></thead><tbody>{filtered.map((employee, index) => {
        const id = String(employee.id); const employment = currentEmploymentByEmployee.get(id); const assignments = activeAssignmentsByEmployee.get(id) ?? []; const load = assignments.reduce((sum, row) => sum + Number(row.allocation_percent ?? 0), 0); const issues = issueSummary.byEmployee.get(id) ?? []; const critical = issues.filter((row) => row.severity === "critical").length;
        return <tr key={id}><td className={styles.lp}>{index + 1}</td><td><button type="button" className={styles.nameButton} onClick={() => setSelectedId(id)}><strong>{employeeName(employee)}</strong></button><div className={styles.subtle}>{text(employee.employee_number)}</div></td><td>{text(employment?.position, "Bez stanowiska")}</td><td><div className={styles.load}><progress max="120" value={Math.min(120, load)} /><strong>{num(load)}%</strong></div></td><td>{issues.length ? <span className={`${core.state} ${critical ? core.stateBad : core.stateWarn}`}>{critical ? `${critical} kryt. / ` : ""}{issues.length} razem</span> : <span className={`${core.state} ${core.stateOk}`}>OK</span>}</td><td>{text(employee.phone)}<div className={styles.subtle}>{text(employee.email)}</div></td><td><span className={`${styles.status} ${String(employee.status) === "active" ? styles.statusActive : styles.statusMuted}`}>{String(employee.status) === "active" ? "Aktywny" : String(employee.status) === "inactive" ? "Archiwum" : "Zakończony"}</span></td><td><div className={styles.rowActions}><button type="button" className={styles.iconButton} onClick={() => setSelectedId(id)} aria-label={`Otwórz kartę ${employeeName(employee)}`}><Pencil size={17} /></button><button type="button" className={styles.iconButton} onClick={() => onOpenTime(id)} aria-label={`Czas pracy ${employeeName(employee)}`}><CalendarDays size={17} /></button></div></td></tr>;
      })}</tbody></table>{!filtered.length ? <div className={styles.empty}>Brak pracowników dla wybranych filtrów.</div> : null}</div>
    </section>
    {selected ? <EmployeeCard300 employee={selected} data={data} employment={currentEmploymentByEmployee.get(String(selected.id))} assignments={activeAssignmentsByEmployee.get(String(selected.id)) ?? []} issues={issueSummary.byEmployee.get(String(selected.id)) ?? []} projectById={projectById} canWrite={canWrite} canApprove={canApprove} canManagePayroll={canManagePayroll} pending={pending} workspaceId={workspaceId} onClose={() => setSelectedId(null)} onSaved={(value) => { setMessage(value); setSelectedId(null); router.refresh(); }} onError={setError} onOpenTime={() => onOpenTime(String(selected.id))} onArchive={() => changeState(String(selected.id), "archive")} onRestore={() => changeState(String(selected.id), "restore")} onDelete={() => changeState(String(selected.id), canApprove ? "force_delete" : "delete")} /> : null}
  </>;
}

function EmployeeCard300({ employee, data, employment, assignments, issues, projectById, canWrite, canApprove, canManagePayroll, pending, workspaceId, onClose, onSaved, onError, onOpenTime, onArchive, onRestore, onDelete }: { employee: HrRow; data: HrWorkspaceData; employment?: HrRow; assignments: HrRow[]; issues: ReturnType<typeof buildHrEmployeeIssues>["issues"]; projectById: Map<string, HrRow>; canWrite: boolean; canApprove: boolean; canManagePayroll: boolean; pending: boolean; workspaceId: string; onClose: () => void; onSaved: (message: string) => void; onError: (message: string | null) => void; onOpenTime: () => void; onArchive: () => void; onRestore: () => void; onDelete: () => void }) {
  const entitlement = data.entitlements.find((row) => String(row.employee_id) === String(employee.id) && Number(row.year) === data.year);
  const employeeCompliance = data.complianceItems.filter((row) => String(row.employee_id) === String(employee.id)).sort((a, b) => String(b.valid_until ?? b.created_at ?? "").localeCompare(String(a.valid_until ?? a.created_at ?? "")));
  const documents = data.employeeDocuments.filter((row) => String(row.employee_id) === String(employee.id));
  const history = data.auditEvents.filter((row) => String(row.entity_type) === "employee" && String(row.entity_id) === String(employee.id)).slice(0, 8);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canWrite) return;
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); onError(null);
    fetch("/api/company/hr/employee-bundle/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, employeeId: String(employee.id), employmentId: employment ? String(employment.id) : null, payload }) })
      .then(async (response) => { const result = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać pracownika."); onSaved("Dane pracownika zapisano atomowo."); })
      .catch((reason) => onError(reason instanceof Error ? reason.message : "Nie udało się zapisać pracownika."));
  };
  if (typeof document === "undefined") return null;
  return createPortal(<div className={styles.modalLayer} data-hr-employee-card="300"><button className={styles.backdrop} onClick={onClose} aria-label="Zamknij kartę pracownika" /><section className={styles.modal} role="dialog" aria-modal="true" aria-label={`Karta ${employeeName(employee)}`}><header className={styles.modalHeader}><div><p className={styles.kicker}>Karta pracownika Core 3.0</p><h2>{employeeName(employee)}</h2></div><button type="button" className={styles.closeButton} onClick={onClose}><X size={18} /></button></header><div className={styles.modalBody}>
    <section className={core.panel}><div className={core.panelHeader}><div><p className={core.kicker}>Centrum problemów</p><h3>{issues.length ? `${issues.length} spraw do kontroli` : "Brak aktywnych problemów"}</h3></div></div><div className={core.issueList}>{issues.slice(0, 12).map((issue) => <div key={issue.id} className={`${core.issue} ${core[issue.severity]}`}><span /><span><strong>{issue.title}</strong><small>{issue.detail}</small></span></div>)}{!issues.length ? <div className={core.empty}>Karta nie ma aktywnych ostrzeżeń.</div> : null}</div></section>
    <form className={styles.editForm} onSubmit={submit}>
      <input type="hidden" name="leaveYear" value={data.year} />
      <fieldset><legend>Dane pracownika</legend><div className={styles.formGrid}><label>Imię<input name="firstName" defaultValue={text(employee.first_name, "")} required disabled={!canWrite} /></label><label>Nazwisko<input name="lastName" defaultValue={text(employee.last_name, "")} required disabled={!canWrite} /></label><label>Numer pracownika<input name="employeeNumber" defaultValue={text(employee.employee_number, "")} disabled={!canWrite} /></label><label>E-mail<input name="email" type="email" defaultValue={text(employee.email, "")} disabled={!canWrite} /></label><label>Telefon<input name="phone" defaultValue={text(employee.phone, "")} disabled={!canWrite} /></label><label>Kontakt awaryjny<input name="emergencyContactName" defaultValue={text(employee.emergency_contact_name, "")} disabled={!canWrite} /></label><label>Telefon awaryjny<input name="emergencyContactPhone" defaultValue={text(employee.emergency_contact_phone, "")} disabled={!canWrite} /></label><label className={styles.fullWidth}>Notatka<textarea name="notes" defaultValue={text(employee.notes, "")} disabled={!canWrite} /></label></div></fieldset>
      <fieldset><legend>Zatrudnienie</legend><div className={styles.formGrid}><label>Stanowisko<input name="position" defaultValue={text(employment?.position, "")} disabled={!canWrite} /></label><label>Forma<select name="employmentType" defaultValue={text(employment?.employment_type, "employment_contract")} disabled={!canWrite}><option value="employment_contract">Umowa o pracę</option><option value="contract">Umowa cywilna</option><option value="b2b">B2B</option></select></label><label>Wymiar etatu<input name="fullTimeEquivalent" inputMode="decimal" defaultValue={text(employment?.full_time_equivalent, "1")} disabled={!canWrite} /></label></div></fieldset>
      <fieldset><legend>Limit urlopu {data.year}</legend><div className={styles.formGrid}><label>Podstawowy<input name="leaveAnnualDays" inputMode="decimal" defaultValue={text(entitlement?.annual_days, "")} disabled={!canWrite} /></label><label>Przeniesione<input name="leaveCarriedOverDays" inputMode="decimal" defaultValue={text(entitlement?.carried_over_days, "0")} disabled={!canWrite} /></label><label>Dodatkowe<input name="leaveExtraDays" inputMode="decimal" defaultValue={text(entitlement?.extra_days, "0")} disabled={!canWrite} /></label><label>Uwagi<input name="leaveNotes" defaultValue={text(entitlement?.notes, "")} disabled={!canWrite} /></label></div></fieldset>
      {canManagePayroll ? <HrCompensationFields150 defaults={{ settlementModel: employment?.settlement_model, operationalNetHourlyRate: employment?.operational_net_hourly_rate, netMonthlyPay: employment?.net_monthly_pay, grossMonthlyPay: employment?.gross_monthly_pay, employerContributions: employment?.employer_contributions, otherMonthlyCosts: employment?.other_monthly_costs, nominalMonthlyHours: employment?.nominal_monthly_hours }} /> : null}
      <fieldset><legend>Inwestycje</legend>{assignments.map((row) => <p key={String(row.id)}><strong>{text(projectById.get(String(row.project_id))?.name)}</strong> · {text(row.role)} · {num(row.allocation_percent)}%</p>)}{!assignments.length ? <p>Brak aktywnych przypisań.</p> : null}</fieldset>
      <fieldset><legend>Badania, BHP i uprawnienia</legend>{employeeCompliance.slice(0, 8).map((row) => <p key={String(row.id)}><strong>{text(row.item_type ?? row.exam_type ?? row.training_type ?? row.qualification_type)}</strong> · ważne do {dateLabel(row.valid_until)}</p>)}{!employeeCompliance.length ? <p>Brak wpisów. Dodaj je w zakładce „Uprawnienia i BHP” lub przez OCR.</p> : null}</fieldset>
      <fieldset><legend>Dokumenty i historia</legend><p>{documents.length} dokumentów powiązanych z pracownikiem.</p>{history.map((row) => <p key={String(row.id)}><strong>{text(row.event_type)}</strong> · {dateLabel(row.created_at)}</p>)}</fieldset>
      <div className={styles.modalActions}><button type="button" onClick={onOpenTime}><CalendarDays size={15} /> Czas pracy</button>{canWrite ? <button type="submit" disabled={pending}>Zapisz atomowo</button> : null}</div>
    </form>
    {canWrite ? <div className={styles.modalActions}>{employee.status === "active" ? <button type="button" onClick={onArchive}><Archive size={15} /> Archiwizuj</button> : <button type="button" onClick={onRestore}><RotateCcw size={15} /> Przywróć</button>}<button type="button" onClick={onDelete}><Trash2 size={15} /> {canApprove ? "Usuń z historią" : "Usuń"}</button></div> : null}
  </div></section></div>, document.body);
}
