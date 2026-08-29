"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, BriefcaseBusiness, CalendarDays, CheckCircle2, Clock3, Download, FileText,
  HardHat, PackageCheck, Plus, Search, ShieldCheck, Upload, UsersRound, WalletCards, X
} from "lucide-react";
import { HrCompensationFields150 } from "./hr-compensation-fields-150";
import { HrTimeRecords145 } from "./hr-time-records-145";
import styles from "./hr-workspace-140.module.css";

type Row = Record<string, unknown>;
type HrData = {
  referenceDate: string;
  year: number;
  employees: Row[];
  projects: Row[];
  employments: Row[];
  payrollMonths: Row[];
  qualifications: Row[];
  exams: Row[];
  trainings: Row[];
  leaves: Row[];
  timesheets: Row[];
  assignments: Row[];
  teams: Row[];
  teamMembers: Row[];
  documents: Row[];
  employeeDocuments: Row[];
  unlinkedDocuments: Row[];
  entitlements: Row[];
  leaveBalances: Row[];
  issuedAssets: Row[];
  complianceItems: Row[];
  projectStaff: Row[];
  alerts: Row[];
  summary: Row;
};

type Tab = "dashboard" | "employees" | "time" | "leaves" | "compliance" | "teams" | "documents";

const tabs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "dashboard", label: "Pulpit", icon: <BriefcaseBusiness size={15} /> },
  { id: "employees", label: "Pracownicy", icon: <UsersRound size={15} /> },
  { id: "time", label: "Czas pracy", icon: <Clock3 size={15} /> },
  { id: "leaves", label: "Urlopy i absencje", icon: <CalendarDays size={15} /> },
  { id: "compliance", label: "Uprawnienia i BHP", icon: <ShieldCheck size={15} /> },
  { id: "teams", label: "Zespoły i inwestycje", icon: <HardHat size={15} /> },
  { id: "documents", label: "Dokumenty", icon: <FileText size={15} /> }
];

function str(value: unknown, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function num(value: unknown, digits = 1) { const n = Number(value ?? 0); return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(n) ? n : 0); }
function money(value: unknown) { const n = Number(value ?? 0); return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0); }
function employeeName(row?: Row) { return row ? `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number) : "Pracownik"; }
function addDays(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function dateLabel(value: unknown) { if (!value) return "—"; const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`); return Number.isNaN(parsed.getTime()) ? str(value) : parsed.toLocaleDateString("pl-PL"); }
function activeOn(row: Row, date: string) { return String(row.date_from ?? "0000-01-01") <= date && (!row.date_to || String(row.date_to) >= date); }
function normalize(value: unknown) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

function Metric({ label, value, caption }: { label: string; value: ReactNode; caption: string }) {
  return <article className={styles.metric}><small>{label}</small><strong>{value}</strong><p>{caption}</p></article>;
}

function Empty({ children }: { children: ReactNode }) { return <div className={styles.empty}>{children}</div>; }

function StatusChip({ status }: { status: unknown }) {
  const value = String(status ?? "").toLowerCase();
  const labels: Record<string, string> = { planned: "Planowane", confirmed: "Potwierdzone", paid: "Wypłacone" };
  const className = ["approved", "active", "valid", "fit", "completed", "confirmed", "paid"].includes(value) ? styles.chipOk : ["expired", "unfit", "terminated", "rejected"].includes(value) ? styles.chipBad : ["pending", "submitted", "review", "draft", "planned"].includes(value) ? styles.chipWarn : styles.chip;
  return <span className={className}>{labels[value] ?? str(status)}</span>;
}

function FormBlock({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className={styles.details} open={open}><summary><Plus size={14} /> {title}</summary><div className={styles.detailsBody}>{children}</div></details>;
}

export function HrWorkspace140({ workspaceId, data, canWrite, canApprove, canViewPayroll, canManagePayroll }: { workspaceId: string; data: HrData; canWrite: boolean; canApprove: boolean; canViewPayroll: boolean; canManagePayroll: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [projectFilter, setProjectFilter] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [employeeCreateOpen, setEmployeeCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeCreateOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setEmployeeCreateOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [employeeCreateOpen]);

  const employeeById = useMemo(() => new Map(data.employees.map((row) => [String(row.id), row])), [data.employees]);
  const projectById = useMemo(() => new Map(data.projects.map((row) => [String(row.id), row])), [data.projects]);
  const employmentByEmployee = useMemo(() => {
    const map = new Map<string, Row>();
    for (const row of data.employments) if (!map.has(String(row.employee_id)) && activeOn(row, data.referenceDate)) map.set(String(row.employee_id), row);
    return map;
  }, [data.employments, data.referenceDate]);
  const activeAssignments = useMemo(() => data.assignments.filter((row) => activeOn(row, data.referenceDate)), [data.assignments, data.referenceDate]);
  const assignmentsByEmployee = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of activeAssignments) map.set(String(row.employee_id), [...(map.get(String(row.employee_id)) ?? []), row]);
    return map;
  }, [activeAssignments]);

  const perform = (action: string, payload: Record<string, unknown>, success: string, onSuccess?: () => void) => {
    setMessage(null); setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/hr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, action, payload }) });
        const result = await response.json().catch(() => ({})) as { error?: string; meta?: Record<string, unknown> };
        if (!response.ok) { setError(result.error ?? "Nie udało się wykonać operacji."); return; }
        const extra = result.meta?.calculatedDays ? ` (${result.meta.calculatedDays} dni roboczych)` : result.meta?.people ? ` (${result.meta.people} osób)` : "";
        setMessage(`${success}${extra}`);
        onSuccess?.();
        router.refresh();
      } catch { setError("Nie udało się połączyć z modułem Kadry."); }
    });
  };

  const submit = (action: string, success: string, onSuccess?: () => void) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    perform(action, payload, success, () => {
      form.reset();
      onSuccess?.();
    });
  };

  const filteredEmployees = useMemo(() => data.employees.filter((employee) => {
    if (statusFilter && String(employee.status) !== statusFilter) return false;
    if (projectFilter && !(assignmentsByEmployee.get(String(employee.id)) ?? []).some((row) => String(row.project_id) === projectFilter)) return false;
    if (!query.trim()) return true;
    const employment = employmentByEmployee.get(String(employee.id));
    const projects = (assignmentsByEmployee.get(String(employee.id)) ?? []).map((row) => projectById.get(String(row.project_id))?.name).join(" ");
    return normalize(`${employeeName(employee)} ${employee.employee_number ?? ""} ${employee.email ?? ""} ${employee.phone ?? ""} ${employment?.position ?? ""} ${projects}`).includes(normalize(query));
  }), [data.employees, statusFilter, projectFilter, query, assignmentsByEmployee, employmentByEmployee, projectById]);

  const selectedEmployee = selectedEmployeeId ? employeeById.get(selectedEmployeeId) ?? null : null;
  const pendingTimesheets = data.timesheets.filter((row) => ["submitted", "pending", "draft"].includes(String(row.status)));
  const pendingLeaves = data.leaves.filter((row) => ["submitted", "pending", "review"].includes(String(row.status)));
  const approvedLeaves = data.leaves.filter((row) => row.status === "approved").sort((a, b) => String(a.date_from).localeCompare(String(b.date_from)));
  const names = employeeById;

  const dashboard = <>
    <section className={styles.metrics}>
      <Metric label="Aktywni" value={str(data.summary.activeEmployees, "0")} caption="Pracownicy gotowi do planowania" />
      <Metric label="Dzisiaj na budowach" value={str(data.summary.todayOnSites, "0")} caption="Przypisani i bez zatwierdzonej absencji" />
      <Metric label="Nieobecni dzisiaj" value={str(data.summary.absentToday, "0")} caption="Zatwierdzone absencje" />
      <Metric label="Bez inwestycji" value={str(data.summary.unassigned, "0")} caption="Aktywni bez bieżącej alokacji" />
      <Metric label="Terminy ≤30 dni" value={str(data.summary.expiring30, "0")} caption={`${str(data.summary.expired, "0")} już wygasłych`} />
      <Metric label="Do zatwierdzenia" value={str(data.summary.pendingDecisions, "0")} caption="Urlopy + karty czasu" />
    </section>
    <section className={styles.grid2}>
      <article className={styles.panel}>
        <div className={styles.panelHeader}><div><p className={styles.kicker}>Octopus HR</p><h2>Wymaga uwagi</h2></div><span className={styles.chip}>{data.alerts.length}</span></div>
        <div className={styles.alertList}>{data.alerts.map((alert, index) => <article data-hr-action-index={index} role="button" tabIndex={0} title="Przejdź do miejsca obsługi tej sprawy" aria-label={`${str(alert.title, "Sprawa kadrowa")}. Przejdź do miejsca obsługi.`} className={`${styles.alert} ${alert.severity === "critical" ? styles.critical : alert.severity === "warning" ? styles.warning : styles.info}`} key={`${str(alert.type)}-${index}`}><div className={styles.alertBody}><AlertTriangle className={styles.alertIcon} size={17} /><div><strong>{str(alert.title)}</strong><div className={styles.subtle}>{str(alert.detail, "")}</div></div></div></article>)}{!data.alerts.length ? <Empty>Brak pilnych spraw kadrowych.</Empty> : null}</div>
      </article>
      <article className={styles.panel}>
        <div className={styles.panelHeader}><div><p className={styles.kicker}>Zasoby</p><h2>Zespół na inwestycjach</h2></div><span className={styles.chip}>{str(data.summary.activeTeams, "0")} brygad</span></div>
        <div className={styles.simpleList}>{data.projectStaff.map((row) => <div className={styles.listItem} key={String(row.project_id)}><div><strong>{str(row.name)}</strong><div className={styles.subtle}>{str(row.people, "0")} osób · {num(row.allocation, 0)}% łącznej alokacji</div></div><UsersRound size={18} /></div>)}{!data.projectStaff.length ? <Empty>Brak aktywnych przypisań do inwestycji.</Empty> : null}</div>
      </article>
    </section>
    {canViewPayroll ? <>
      <section className={styles.grid3} data-hr-payroll-summary>
        <article className={styles.panel}><h3>Do wypłaty netto</h3><strong>{money(data.summary.monthlyNetPay)}</strong><p className={styles.subtle}>Planowana lub zapisana kwota „na rękę” w tym miesiącu.</p></article>
        <article className={styles.panel}><h3>ZUS i pozostałe koszty</h3><strong>{money(Number(data.summary.monthlyEmployerContributions ?? 0) + Number(data.summary.monthlyOtherCosts ?? 0))}</strong><p className={styles.subtle}>Składki pracodawcy, PPK, dodatki i inne koszty.</p></article>
        <article className={styles.panel}><h3>Pełny koszt zatrudnienia</h3><strong>{money(data.summary.monthlyEmploymentCost)}</strong><p className={styles.subtle}>Brutto + składki pracodawcy + pozostałe koszty.</p></article>
      </section>
      <article className={styles.payrollControl}>
        <div><p className={styles.kicker}>Kontrola miesiąca</p><h3>{str(data.summary.payrollConfirmed, "0")} z {str(data.summary.activeEmployees, "0")} rozliczeń potwierdzonych</h3><p className={styles.subtle}>{str(data.summary.payrollMissing, "0")} pracowników korzysta jeszcze z planu wynikającego z warunków zatrudnienia.</p></div>
        <div className={styles.payrollFigures}><span><small>Rozliczone czasem</small><strong>{money(data.summary.approvedLaborCost)}</strong></span><span><small>Nieprzypisane</small><strong>{money(data.summary.unallocatedEmploymentCost)}</strong></span><span><small>Sprzęt i ŚOI</small><strong>{str(data.summary.issuedAssets, "0")}</strong></span></div>
      </article>
    </> : <article className={styles.panel}><h3>Sprzęt i ŚOI</h3><strong>{str(data.summary.issuedAssets, "0")}</strong><p className={styles.subtle}>Dane wynagrodzeń są widoczne tylko dla uprawnionych ról Kadry–płace i Finanse.</p></article>}
  </>;

  const employeeTab = <>
    <article className={styles.panel} data-hr-employee-list>
      <div className={styles.sectionLead}><div><p className={styles.kicker}>Kartoteka</p><h2>Pracownicy</h2></div><span className={styles.chip}>{filteredEmployees.length}</span></div>
      <div className={styles.searchRow}><div style={{ display: "contents" }}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Imię, stanowisko, inwestycja, telefon, e-mail…" /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Wszystkie statusy</option><option value="active">Aktywni</option><option value="inactive">Nieaktywni</option><option value="terminated">Zakończone</option></select><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">Wszystkie inwestycje</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{str(row.name)}</option>)}</select></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Pracownik</th><th>Stanowisko</th><th>Aktualna inwestycja</th><th>Obłożenie</th><th>Kontakt</th><th>Status</th></tr></thead><tbody>{filteredEmployees.map((row) => { const employment = employmentByEmployee.get(String(row.id)); const assignments = assignmentsByEmployee.get(String(row.id)) ?? []; const load = assignments.reduce((sum, item) => sum + Number(item.allocation_percent ?? 0), 0); return <tr key={String(row.id)} onClick={() => setSelectedEmployeeId(String(row.id))}><td><strong>{employeeName(row)}</strong><div className={styles.subtle}>{str(row.employee_number)}</div></td><td>{str(employment?.position, "Bez stanowiska")}</td><td>{assignments.map((item) => str(projectById.get(String(item.project_id))?.name)).join(" · ") || "Bez przypisania"}</td><td><div className={styles.load}><progress max="120" value={Math.min(120, load)} /><strong>{num(load, 0)}%</strong></div></td><td>{str(row.phone)}<div className={styles.subtle}>{str(row.email)}</div></td><td><StatusChip status={row.status} /></td></tr>; })}</tbody></table>{!filteredEmployees.length ? <Empty>Brak pracowników dla wybranych filtrów.</Empty> : null}</div>
    </article>
  </>;

  const timeTab = <>
    <section className={styles.grid2}>
      {canWrite ? <article className={styles.panel}><h2>Wpis dla brygady</h2><p className={styles.subtle}>Jednym zapisem uzupełnij dzień wszystkim aktywnym członkom brygady; istniejące wpisy tego dnia zostaną zaktualizowane.</p><form className={styles.form} onSubmit={submit("timesheet_bulk_team", "Czas pracy brygady został zapisany.")}><label>Brygada<select name="teamId" required><option value="">Wybierz</option>{data.teams.filter((row) => row.active !== false).map((row) => <option key={String(row.id)} value={String(row.id)}>{str(row.name)}</option>)}</select></label><label>Inwestycja<select name="projectId"><option value="">Koszt ogólny</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{str(row.name)}</option>)}</select></label><div className={styles.formGrid}><label>Data<input name="workDate" type="date" defaultValue={data.referenceDate} /></label><label>Godziny<input name="hours" inputMode="decimal" defaultValue="8" required /></label><label>Nadgodziny<input name="overtimeHours" inputMode="decimal" defaultValue="0" /></label></div><button className={styles.button} disabled={pending}><Clock3 size={15} /> Wpisz wszystkim</button></form></article> : null}
      {canWrite ? <article className={styles.panel}><h2>Pojedynczy wpis</h2><form className={styles.form} onSubmit={submit("timesheet_create", "Czas pracy został zapisany.")}><label>Pracownik<select name="employeeId" required><option value="">Wybierz</option>{data.employees.filter((row) => row.status === "active").map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label><label>Inwestycja<select name="projectId"><option value="">Koszt ogólny</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{str(row.name)}</option>)}</select></label><div className={styles.formGrid}><label>Data<input name="workDate" type="date" defaultValue={data.referenceDate} /></label><label>Godziny<input name="hours" inputMode="decimal" defaultValue="8" required /></label><label>Nadgodziny<input name="overtimeHours" inputMode="decimal" defaultValue="0" /></label></div><button className={styles.buttonSecondary} disabled={pending}>Dodaj wpis</button></form></article> : null}
    </section>
    <HrTimeRecords145 workspaceId={workspaceId} referenceDate={data.referenceDate} employees={data.employees} projects={data.projects} timesheets={data.timesheets} />
    <article className={styles.panel}><h2>Do zatwierdzenia</h2><div className={styles.simpleList}>{pendingTimesheets.slice(0, 30).map((row) => <div className={styles.listItem} key={String(row.id)}><div><strong>{employeeName(names.get(String(row.employee_id)))}</strong><div className={styles.subtle}>{dateLabel(row.work_date)} · {num(row.hours)} h + {num(row.overtime_hours)} h nadgodzin · {str(projectById.get(String(row.project_id))?.name, "Koszt ogólny")}</div></div>{canApprove ? <div className={styles.splitButtons}><button className={styles.buttonSecondary} disabled={pending} onClick={() => perform("timesheet_decision", { timesheetId: row.id, decision: "approved" }, "Wpis zatwierdzony.")}>Zatwierdź</button><button className={styles.buttonDanger} disabled={pending} onClick={() => perform("timesheet_decision", { timesheetId: row.id, decision: "rejected" }, "Wpis odrzucony.")}>Odrzuć</button></div> : <StatusChip status={row.status} />}</div>)}{!pendingTimesheets.length ? <Empty>Brak kart czasu oczekujących na decyzję.</Empty> : null}</div></article>
  </>;

  const leavesTab = <>
    <section className={styles.grid2}>
      {canWrite ? <article className={styles.panel}><h2>Nowy wniosek urlopowy</h2><p className={styles.subtle}>Liczba dni jest liczona automatycznie z uwzględnieniem weekendów i świąt ustawowych w Polsce.</p><form className={styles.form} onSubmit={submit("leave_create", "Wniosek urlopowy został zapisany.")}><label>Pracownik<select name="employeeId" required><option value="">Wybierz</option>{data.employees.filter((row) => row.status === "active").map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label><label>Rodzaj<select name="leaveType" defaultValue="annual"><option value="annual">Wypoczynkowy</option><option value="on_demand">Na żądanie</option><option value="unpaid">Bezpłatny</option><option value="sick">Chorobowe</option><option value="care">Opieka</option></select></label><div className={styles.formGrid}><label>Od<input name="dateFrom" type="date" required /></label><label>Do<input name="dateTo" type="date" required /></label></div><button className={styles.button} disabled={pending}>Zapisz wniosek</button></form></article> : null}
      {canWrite ? <article className={styles.panel}><h2>Limit urlopowy {data.year}</h2><p className={styles.subtle}>Wymiar musi być ustawiony świadomie dla danego roku — system nie zakłada automatycznie 26 dni.</p><form className={styles.form} onSubmit={submit("leave_entitlement_upsert", "Limit urlopowy został zapisany.")}><label>Pracownik<select name="employeeId" required><option value="">Wybierz</option>{data.employees.map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label><input type="hidden" name="year" value={String(data.year)} /><div className={styles.formGrid}><label>Wymiar roczny<input name="annualDays" inputMode="decimal" placeholder="20 / 26 / inny" required /></label><label>Zaległe<input name="carriedOverDays" inputMode="decimal" defaultValue="0" /></label><label>Dodatkowe<input name="extraDays" inputMode="decimal" defaultValue="0" /></label></div><button className={styles.buttonSecondary} disabled={pending}>Ustaw limit</button></form></article> : null}
    </section>
    <section className={styles.grid2}><article className={styles.panel}><h2>Salda urlopowe</h2><div className={styles.simpleList}>{data.leaveBalances.map((row) => <div className={styles.listItem} key={String(row.employee_id)}><div><strong>{employeeName(employeeById.get(String(row.employee_id)))}</strong>{row.entitlement_configured ? <div className={styles.subtle}>Wykorzystano {num(row.used_days)} z {num(Number(row.annual_days ?? 0) + Number(row.carried_over_days ?? 0) + Number(row.extra_days ?? 0))} dni</div> : <div className={styles.subtle}>Limit na {data.year} r. nie został ustawiony.</div>}</div><strong>{row.entitlement_configured ? `${num(row.remaining_days)} dni` : "Nie ustawiono"}</strong></div>)}{!data.leaveBalances.length ? <Empty>Brak pracowników do wyliczenia sald.</Empty> : null}</div></article><article className={styles.panel}><h2>Kalendarz absencji</h2><div className={styles.calendar}>{approvedLeaves.slice(0, 30).map((row) => <div className={styles.absence} key={String(row.id)}><strong>{employeeName(employeeById.get(String(row.employee_id)))}</strong><span>{dateLabel(row.date_from)}–{dateLabel(row.date_to)}</span><StatusChip status={row.leave_type} /></div>)}{!approvedLeaves.length ? <Empty>Brak zatwierdzonych absencji.</Empty> : null}</div></article></section>
    <article className={styles.panel}><h2>Wnioski do decyzji</h2><div className={styles.simpleList}>{pendingLeaves.map((row) => <div className={styles.listItem} key={String(row.id)}><div><strong>{employeeName(employeeById.get(String(row.employee_id)))}</strong><div className={styles.subtle}>{dateLabel(row.date_from)}–{dateLabel(row.date_to)} · {num(row.days)} dni · {str(row.leave_type)}</div></div>{canApprove ? <div className={styles.splitButtons}><button className={styles.buttonSecondary} disabled={pending} onClick={() => perform("leave_decision", { leaveId: row.id, decision: "approved" }, "Urlop zatwierdzony.")}>Zatwierdź</button><button className={styles.buttonDanger} disabled={pending} onClick={() => perform("leave_decision", { leaveId: row.id, decision: "rejected" }, "Urlop odrzucony.")}>Odrzuć</button></div> : <StatusChip status={row.status} />}</div>)}{!pendingLeaves.length ? <Empty>Brak wniosków oczekujących na decyzję.</Empty> : null}</div></article>
  </>;

  const complianceTab = <>
    {canWrite ? <section className={styles.grid3}>
      <article className={styles.panel}><h3>Uprawnienie / certyfikat</h3><form className={styles.form} onSubmit={submit("qualification_create", "Uprawnienie zostało zapisane.")}><label>Pracownik<select name="employeeId" required><option value="">Wybierz</option>{data.employees.map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label><label>Rodzaj<input name="qualificationType" required placeholder="SEP, UDT, F-Gazy" /></label><label>Numer<input name="number" /></label><div className={styles.formGrid}><label>Wydano<input name="issuedAt" type="date" /></label><label>Ważne do<input name="validUntil" type="date" /></label></div><button className={styles.buttonSecondary} disabled={pending}>Dodaj</button></form></article>
      <article className={styles.panel}><h3>Badanie medyczne</h3><form className={styles.form} onSubmit={submit("medical_exam_create", "Badanie zostało zapisane.")}><label>Pracownik<select name="employeeId" required><option value="">Wybierz</option>{data.employees.map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label><label>Rodzaj<input name="examType" required placeholder="Wstępne / okresowe / kontrolne" /></label><div className={styles.formGrid}><label>Data badania<input name="examinedAt" type="date" /></label><label>Ważne do<input name="validUntil" type="date" required /></label></div><label>Wynik<select name="result" defaultValue="fit"><option value="fit">Zdolny</option><option value="fit_with_restrictions">Z ograniczeniami</option><option value="unfit">Niezdolny</option></select></label><button className={styles.buttonSecondary} disabled={pending}>Dodaj</button></form></article>
      <article className={styles.panel}><h3>Szkolenie BHP</h3><form className={styles.form} onSubmit={submit("safety_training_create", "Szkolenie BHP zostało zapisane.")}><label>Pracownik<select name="employeeId" required><option value="">Wybierz</option>{data.employees.map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label><label>Rodzaj<input name="trainingType" required placeholder="Wstępne / okresowe" /></label><label>Organizator<input name="provider" /></label><div className={styles.formGrid}><label>Ukończono<input name="completedAt" type="date" /></label><label>Ważne do<input name="validUntil" type="date" /></label></div><button className={styles.buttonSecondary} disabled={pending}>Dodaj</button></form></article>
    </section> : null}
    <article className={styles.panel}><div className={styles.panelHeader}><div><p className={styles.kicker}>Zdolność do pracy</p><h2>Uprawnienia, badania i BHP</h2></div><div className={styles.splitButtons}><span className={styles.chipBad}>{str(data.summary.expired, "0")} wygasłych</span><span className={styles.chipBad}>{str(data.summary.expiring7, "0")} ≤7 dni</span><span className={styles.chipWarn}>{str(data.summary.expiring14, "0")} ≤14 dni</span><span className={styles.chipWarn}>{str(data.summary.expiring30, "0")} ≤30 dni</span></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Pracownik</th><th>Rodzaj</th><th>Kategoria</th><th>Wydano</th><th>Ważne do</th><th>Status</th></tr></thead><tbody>{data.complianceItems.map((row) => { const valid = row.valid_until ? String(row.valid_until) : null; const status = valid && valid < data.referenceDate ? "expired" : valid && valid <= addDays(data.referenceDate, 30) ? "expiring" : row.status; return <tr key={`${str(row.item_kind)}-${str(row.id)}`} onClick={() => setSelectedEmployeeId(String(row.employee_id))}><td><strong>{employeeName(employeeById.get(String(row.employee_id)))}</strong></td><td>{str(row.item_type)}</td><td>{str(row.item_kind)}</td><td>{dateLabel(row.issued_on)}</td><td>{dateLabel(row.valid_until)}</td><td><StatusChip status={status} /></td></tr>; })}</tbody></table>{!data.complianceItems.length ? <Empty>Brak zapisanych badań, szkoleń i uprawnień.</Empty> : null}</div></article>
  </>;

  const teamsTab = <>
    {canWrite ? <FormBlock title="Utwórz brygadę">
      <form className={styles.form} onSubmit={submit("team_create", "Brygada została utworzona.")}><div className={styles.formGrid}><label>Nazwa<input name="name" required placeholder="Brygada sanitarna 1" /></label><label>Brygadzista<select name="leaderEmployeeId"><option value="">Bez brygadzisty</option>{data.employees.filter((row) => row.status === "active").map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label><label>Aktualna inwestycja<select name="projectId"><option value="">Bez przypisania</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{str(row.name)}</option>)}</select></label><label>Uwagi<input name="notes" /></label></div><button className={styles.button} disabled={pending}>Utwórz brygadę</button></form>
    </FormBlock> : null}
    <section className={styles.teamGrid}>{data.teams.map((team) => { const members = data.teamMembers.filter((row) => String(row.team_id) === String(team.id) && activeOn(row, data.referenceDate)); const project = projectById.get(String(team.project_id)); const leader = employeeById.get(String(team.leader_employee_id)); return <article className={styles.teamCard} key={String(team.id)}><div className={styles.panelHeader}><div><h3>{str(team.name)}</h3><div className={styles.subtle}>{project ? `📍 ${str(project.name)}` : "Bez inwestycji"} · brygadzista: {leader ? employeeName(leader) : "nie wskazano"}</div></div><span className={styles.chip}>{members.length} osób</span></div><div>{members.map((member) => <div className={styles.member} key={String(member.id)}><div><strong>{employeeName(employeeById.get(String(member.employee_id)))}</strong><div className={styles.subtle}>{str(member.role, "Członek brygady")} · {num(member.allocation_percent ?? 100, 0)}%</div></div>{canWrite ? <button className={styles.buttonDanger} disabled={pending} onClick={() => perform("team_member_remove", { memberId: member.id }, "Pracownik został odłączony od brygady.")}>Odłącz</button> : null}</div>)}</div>{canWrite ? <><form className={styles.form} onSubmit={submit("team_member_add", "Pracownik został dodany do brygady.")}><input type="hidden" name="teamId" value={String(team.id)} /><label>Dodaj członka<select name="employeeId" required><option value="">Wybierz</option>{data.employees.filter((row) => row.status === "active" && !members.some((member) => String(member.employee_id) === String(row.id))).map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label><div className={styles.formGrid}><label>Rola<input name="role" placeholder="Monter / pomocnik" /></label><label>Zaangażowanie %<input name="allocationPercent" defaultValue="100" inputMode="decimal" /></label></div><input type="hidden" name="dateFrom" value={data.referenceDate} /><button className={styles.buttonSecondary} disabled={pending}>Dodaj do brygady</button></form><form className={styles.form} onSubmit={submit("team_assign_project", "Brygada została przypisana do inwestycji.")}><input type="hidden" name="teamId" value={String(team.id)} /><label>Przypisz całą brygadę<select name="projectId" required><option value="">Wybierz inwestycję</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{str(row.name)}</option>)}</select></label><div className={styles.formGrid}><label>Od<input name="dateFrom" type="date" defaultValue={data.referenceDate} /></label><label>Do<input name="dateTo" type="date" /></label></div><button className={styles.button} disabled={pending}>Przypisz zespół</button></form></> : null}</article>; })}{!data.teams.length ? <article className={styles.panel}><Empty>Nie utworzono jeszcze brygad. Zacznij od pierwszego zespołu roboczego.</Empty></article> : null}</section>
  </>;

  const documentsTab = <>
    <section className={styles.grid2}>
      <article className={styles.panel}><h2>Wrzutnia dokumentów HR</h2><p>Wgraj PDF/Word/Excel do istniejącej Wrzutni. Po analizie dokument pojawi się poniżej i Octopus spróbuje dopasować go do pracownika.</p><Link className={styles.button} href={`/workspace/companies/${workspaceId}/documents`}><Upload size={15} /> Otwórz Wrzutnię</Link></article>
      {canWrite ? <article className={styles.panel}><h2>Powiąż dokument ręcznie</h2><form className={styles.form} onSubmit={submit("employee_document_link", "Dokument został przypisany do pracownika.")}><label>Pracownik<select name="employeeId" required><option value="">Wybierz</option>{data.employees.map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label><label>Dokument<select name="documentId"><option value="">Wpis bez pliku</option>{data.documents.map((row) => <option key={String(row.id)} value={String(row.id)}>{str(row.name)}</option>)}</select></label><div className={styles.formGrid}><label>Typ<input name="documentType" required placeholder="SEP / BHP / umowa / badanie" /></label><label>Numer<input name="documentNumber" /></label><label>Wydano<input name="issuedAt" type="date" /></label><label>Ważne do<input name="validUntil" type="date" /></label></div><button className={styles.buttonSecondary} disabled={pending}>Powiąż</button></form></article> : null}
    </section>
    <article className={styles.panel}><h2>AI — dokumenty bez pracownika</h2><div className={styles.simpleList}>{data.unlinkedDocuments.slice(0, 30).map((row) => <div className={styles.docCard} key={String(row.id)}><div><strong>{str(row.name)}</strong><div className={styles.subtle}>AI: {str(row.ai_status)} · weryfikacja: {str(row.review_status)}</div></div>{canWrite ? <button className={styles.buttonSecondary} disabled={pending} onClick={() => perform("employee_document_autolink", { documentId: row.id }, "Octopus utworzył sugestię przypisania dokumentu.")}>Rozpoznaj i przypisz</button> : null}</div>)}{!data.unlinkedDocuments.length ? <Empty>Brak nieprzypisanych dokumentów HR.</Empty> : null}</div></article>
    <article className={styles.panel}><h2>Dokumenty pracowników</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Pracownik</th><th>Typ</th><th>Numer</th><th>Ważne do</th><th>Źródło</th><th>AI</th></tr></thead><tbody>{data.employeeDocuments.map((row) => <tr key={String(row.id)} onClick={() => setSelectedEmployeeId(String(row.employee_id))}><td><strong>{employeeName(employeeById.get(String(row.employee_id)))}</strong></td><td>{str(row.document_type)}</td><td>{str(row.document_number)}</td><td>{dateLabel(row.valid_until)}</td><td>{str(row.source)}</td><td>{row.ai_confidence !== null && row.ai_confidence !== undefined ? `${num(Number(row.ai_confidence) * 100, 0)}%` : "—"}<div className={styles.subtle}>{str(row.ai_explanation, "")}</div></td></tr>)}</tbody></table>{!data.employeeDocuments.length ? <Empty>Brak dokumentów przypisanych do pracowników.</Empty> : null}</div></article>
  </>;

  const content = tab === "dashboard" ? dashboard : tab === "employees" ? employeeTab : tab === "time" ? timeTab : tab === "leaves" ? leavesTab : tab === "compliance" ? complianceTab : tab === "teams" ? teamsTab : documentsTab;

  return <div className={styles.root}>
    <div className={styles.toolbar}><nav className={styles.tabs} aria-label="Sekcje modułu Kadry">{tabs.map((item) => <button key={item.id} type="button" className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`} onClick={() => setTab(item.id)}>{item.icon} {item.label}</button>)}</nav><div className={styles.actions}>{canWrite && tab === "employees" ? <button type="button" className={styles.button} onClick={() => { setError(null); setEmployeeCreateOpen(true); }}><Plus size={15} /> Dodaj pracownika</button> : null}<Link className={styles.buttonSecondary} href={`/api/company/hr/export?workspaceId=${encodeURIComponent(workspaceId)}`}><Download size={15} /> Raport CSV</Link></div></div>
    {message ? <div className={styles.feedback} role="status"><CheckCircle2 size={16} /> {message}</div> : null}
    {error ? <div className={`${styles.feedback} ${styles.feedbackError}`} role="alert"><AlertTriangle size={16} /> {error}</div> : null}
    {content}
    {employeeCreateOpen ? <EmployeeCreateModal
      referenceDate={data.referenceDate}
      pending={pending}
      error={error}
      canManagePayroll={canManagePayroll}
      close={() => setEmployeeCreateOpen(false)}
      submit={submit("employee_create", "Pracownik został dodany.", () => setEmployeeCreateOpen(false))}
    /> : null}
    {selectedEmployee ? <EmployeeDrawer employee={selectedEmployee} data={data} canWrite={canWrite} canViewPayroll={canViewPayroll} canManagePayroll={canManagePayroll} pending={pending} perform={perform} submit={submit} close={() => setSelectedEmployeeId(null)} employeeById={employeeById} projectById={projectById} /> : null}
  </div>;
}

function EmployeeCreateModal({ referenceDate, pending, error, canManagePayroll, close, submit }: { referenceDate: string; pending: boolean; error: string | null; canManagePayroll: boolean; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className={styles.modalLayer}>
    <button type="button" className={styles.modalBackdrop} onClick={close} aria-label="Zamknij dodawanie pracownika" />
    <section className={styles.employeeModal} role="dialog" aria-modal="true" aria-labelledby="employee-create-title">
      <header className={styles.modalHeader}>
        <div><p className={styles.kicker}>Kartoteka pracowników</p><h2 id="employee-create-title">Dodaj pracownika</h2></div>
        <button type="button" className={styles.iconButton} onClick={close} aria-label="Zamknij"><X size={18} /></button>
      </header>
      <div className={styles.modalBody}>
        {error ? <div className={`${styles.feedback} ${styles.feedbackError}`} role="alert"><AlertTriangle size={16} /> {error}</div> : null}
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            <label>Imię<input name="firstName" autoFocus required /></label><label>Nazwisko<input name="lastName" required /></label>
            <label>Numer pracownika<input name="employeeNumber" /></label><label>Stanowisko<input name="position" /></label>
            <label>E-mail<input name="email" type="email" /></label><label>Telefon<input name="phone" /></label>
            <label>Forma zatrudnienia<select name="employmentType" defaultValue="employment_contract"><option value="employment_contract">Umowa o pracę</option><option value="contract">Umowa cywilna</option><option value="b2b">B2B</option></select></label><label>Data zatrudnienia<input name="hiredAt" type="date" defaultValue={referenceDate} /></label>
            <label>Wymiar etatu<input name="fullTimeEquivalent" inputMode="decimal" placeholder="1,0" /></label><label>Kontakt awaryjny<input name="emergencyContactName" /></label>
            <label>Telefon awaryjny<input name="emergencyContactPhone" /></label><label>Notatka<input name="notes" /></label>
          </div>
          {canManagePayroll ? <HrCompensationFields150 /> : <p className={styles.fieldHint}>Dane wynagrodzenia uzupełni osoba z uprawnieniem Kadry–płace lub Finanse.</p>}
          <div className={styles.modalActions}><button type="button" className={styles.buttonSecondary} onClick={close}>Anuluj</button><button className={styles.button} disabled={pending}><Plus size={15} /> {pending ? "Dodawanie…" : "Dodaj pracownika"}</button></div>
        </form>
      </div>
    </section>
  </div>;
}

function EmployeeDrawer({ employee, data, canWrite, canViewPayroll, canManagePayroll, pending, perform, submit, close, projectById }: { employee: Row; data: HrData; canWrite: boolean; canViewPayroll: boolean; canManagePayroll: boolean; pending: boolean; perform: (action: string, payload: Record<string, unknown>, success: string) => void; submit: (action: string, success: string) => (event: FormEvent<HTMLFormElement>) => void; close: () => void; employeeById: Map<string, Row>; projectById: Map<string, Row> }) {
  const employeeId = String(employee.id);
  const employments = data.employments.filter((row) => String(row.employee_id) === employeeId).sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)));
  const currentEmployment = employments.find((row) => activeOn(row, data.referenceDate));
  const payrollMonths = data.payrollMonths.filter((row) => String(row.employee_id) === employeeId).sort((a, b) => String(b.period_month).localeCompare(String(a.period_month)));
  const assignments = data.assignments.filter((row) => String(row.employee_id) === employeeId && activeOn(row, data.referenceDate));
  const timesheets = data.timesheets.filter((row) => String(row.employee_id) === employeeId);
  const leaves = data.leaves.filter((row) => String(row.employee_id) === employeeId);
  const compliance = data.complianceItems.filter((row) => String(row.employee_id) === employeeId);
  const documents = data.employeeDocuments.filter((row) => String(row.employee_id) === employeeId);
  const assets = data.issuedAssets.filter((row) => String(row.employee_id) === employeeId);
  const monthEntries = timesheets.filter((row) => String(row.work_date).startsWith(data.referenceDate.slice(0, 7)) && row.status === "approved");
  const monthHours = monthEntries.reduce((sum, row) => sum + Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0), 0);
  const hourCost = Number(currentEmployment?.hourly_cost ?? 0);
  const projectCost = new Map<string, number>();
  for (const row of monthEntries) {
    const key = String(row.project_id ?? "general");
    projectCost.set(key, (projectCost.get(key) ?? 0) + (Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0)) * hourCost);
  }
  const maxProjectCost = Math.max(1, ...projectCost.values());
  const balance = data.leaveBalances.find((row) => String(row.employee_id) === employeeId);
  const totalCost = Number(currentEmployment?.monthly_cost ?? 0);
  const netPay = Number(currentEmployment?.net_monthly_pay ?? 0);
  const publicAndOther = Math.max(0, totalCost - netPay);

  return <div className={styles.profileLayer}>
    <button className={styles.backdrop} onClick={close} aria-label="Zamknij profil" />
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Karta pracownika ${employeeName(employee)}`}>
      <header className={styles.drawerHeader}>
        <div><p className={styles.kicker}>Karta pracownika</p><h2>{employeeName(employee)}</h2><div className={styles.subtle}>{str(currentEmployment?.position, "Bez stanowiska")} · {str(currentEmployment?.employment_type, "forma nieuzupełniona")} · <StatusChip status={employee.status} /></div></div>
        <button type="button" className={styles.iconButton} onClick={close} aria-label="Zamknij"><X size={18} /></button>
      </header>
      <div className={styles.profileSections}>
        <section className={styles.profileSection} data-hr-employee-summary>
          <h3>Podsumowanie</h3>
          <div className={styles.miniGrid}>
            <div className={styles.mini}><small>Telefon</small><strong>{str(employee.phone)}</strong></div>
            <div className={styles.mini}><small>E-mail</small><strong>{str(employee.email)}</strong></div>
            <div className={styles.mini}><small>Godziny w miesiącu</small><strong>{num(monthHours)} h</strong></div>
            <div className={styles.mini}><small>Urlop pozostały</small><strong>{balance?.entitlement_configured ? `${num(balance.remaining_days)} dni` : "Nie ustawiono"}</strong></div>
          </div>
        </section>

        {canViewPayroll ? <section className={`${styles.profileSection} ${styles.payrollSection}`} data-hr-employee-payroll>
          <div className={styles.sectionLead}><div><p className={styles.kicker}>Dane chronione</p><h3>Wynagrodzenie i koszt pracodawcy</h3></div><WalletCards size={20} /></div>
          <div className={styles.compensationGrid}>
            <div className={styles.mini}><small>Do wypłaty netto</small><strong>{money(currentEmployment?.net_monthly_pay)}</strong></div>
            <div className={styles.mini}><small>Wynagrodzenie brutto</small><strong>{money(currentEmployment?.gross_monthly_pay)}</strong></div>
            <div className={styles.mini}><small>ZUS / składki pracodawcy</small><strong>{money(currentEmployment?.employer_contributions)}</strong></div>
            <div className={styles.mini}><small>Pozostałe koszty</small><strong>{money(currentEmployment?.other_monthly_costs)}</strong></div>
            <div className={`${styles.mini} ${styles.totalCost}`}><small>Pełny koszt firmy</small><strong>{money(currentEmployment?.monthly_cost)}</strong></div>
            <div className={styles.mini}><small>Pełny koszt 1 r-g</small><strong>{money(currentEmployment?.hourly_cost)}</strong></div>
          </div>
          {currentEmployment?.gross_monthly_pay == null && currentEmployment?.monthly_cost != null ? <p className={styles.fieldHint}>Starszy zapis zawiera pełny koszt bez szczegółowego rozbicia. Dodaj nowe warunki zatrudnienia, aby uzupełnić netto, brutto i ZUS.</p> : null}
          {totalCost > 0 && netPay > 0 ? <div className={styles.compensationBar} aria-label="Struktura kosztu pracownika"><span style={{ width: `${Math.min(100, netPay / totalCost * 100)}%` }}>Netto</span><span style={{ width: `${Math.min(100, publicAndOther / totalCost * 100)}%` }}>Obciążenia i inne</span></div> : null}

          <h4>Historia warunków</h4>
          <div className={styles.tableWrap}><table className={`${styles.table} ${styles.compactTable}`}><thead><tr><th>Okres</th><th>Netto</th><th>Brutto</th><th>ZUS pracodawcy</th><th>Pełny koszt</th></tr></thead><tbody>{employments.map((row) => <tr key={String(row.id)}><td>{dateLabel(row.valid_from)}–{row.valid_to ? dateLabel(row.valid_to) : "obecnie"}<div className={styles.subtle}>{str(row.position)}</div></td><td>{row.net_monthly_pay == null ? "—" : money(row.net_monthly_pay)}</td><td>{row.gross_monthly_pay == null ? "—" : money(row.gross_monthly_pay)}</td><td>{row.employer_contributions == null ? "—" : money(row.employer_contributions)}</td><td><strong>{money(row.monthly_cost)}</strong></td></tr>)}</tbody></table></div>

          <h4>Rozliczenia miesięczne</h4>
          <div className={styles.simpleList}>{payrollMonths.map((row) => <div className={styles.payrollRow} key={String(row.id)}><div><strong>{new Date(`${String(row.period_month).slice(0, 10)}T00:00:00`).toLocaleDateString("pl-PL", { month: "long", year: "numeric" })}</strong><div className={styles.subtle}>Netto {money(row.net_pay)} · brutto {money(row.gross_pay)} · ZUS pracodawcy {money(row.employer_contributions)} · pełny koszt {money(row.total_employer_cost)}</div></div><div className={styles.payrollRowActions}><StatusChip status={row.status} />{canManagePayroll && row.status === "planned" ? <button type="button" className={styles.buttonSecondary} disabled={pending} onClick={() => perform("payroll_status", { payrollId: row.id, status: "confirmed" }, "Rozliczenie zostało potwierdzone.")}>Potwierdź</button> : null}{canManagePayroll && row.status === "confirmed" ? <button type="button" className={styles.buttonSecondary} disabled={pending} onClick={() => perform("payroll_status", { payrollId: row.id, status: "paid" }, "Rozliczenie oznaczono jako wypłacone.")}>Oznacz wypłatę</button> : null}</div></div>)}{!payrollMonths.length ? <Empty>Brak zapisanych rozliczeń miesięcznych. Pulpit korzysta z planowanych warunków zatrudnienia.</Empty> : null}</div>

          {canManagePayroll ? <FormBlock title="Dodaj lub aktualizuj rozliczenie miesiąca">
            <form className={styles.form} onSubmit={submit("payroll_upsert", "Rozliczenie miesiąca zostało zapisane.")}>
              <input type="hidden" name="employeeId" value={employeeId} />
              <div className={styles.formGrid}><label>Miesiąc<input name="periodMonth" type="month" defaultValue={data.referenceDate.slice(0, 7)} required /></label><label>Status<select name="status" defaultValue="planned"><option value="planned">Planowane</option><option value="confirmed">Potwierdzone</option><option value="paid">Wypłacone</option></select></label><label>Data wypłaty<input name="paidAt" type="date" /></label><label>Notatka<input name="notes" /></label></div>
              <HrCompensationFields150 requireGross defaults={{ netMonthlyPay: currentEmployment?.net_monthly_pay, grossMonthlyPay: currentEmployment?.gross_monthly_pay, employerContributions: currentEmployment?.employer_contributions, otherMonthlyCosts: currentEmployment?.other_monthly_costs, nominalMonthlyHours: currentEmployment?.nominal_monthly_hours }} />
              <button className={styles.button} disabled={pending}><WalletCards size={15} /> Zapisz rozliczenie</button>
            </form>
          </FormBlock> : null}
        </section> : null}

        <section className={styles.profileSection}><h3>{canViewPayroll ? "Inwestycje i koszt pracy" : "Inwestycje"}</h3>{assignments.map((row) => <p key={String(row.id)}><strong>{str(projectById.get(String(row.project_id))?.name)}</strong> · {str(row.role)} · {num(row.allocation_percent, 0)}%</p>)}{!assignments.length ? <p className={styles.subtle}>Brak aktywnego przypisania.</p> : null}{canViewPayroll ? <div className={styles.simpleList}>{Array.from(projectCost.entries()).map(([projectId, value]) => <div className={styles.costBar} key={projectId}><span>{projectId === "general" ? "Koszty ogólne" : str(projectById.get(projectId)?.name)}</span><div className={styles.costTrack}><span style={{ width: `${Math.max(4, value / maxProjectCost * 100)}%` }} /></div><strong>{money(value)}</strong></div>)}</div> : null}</section>
        <section className={styles.profileSection}><h3>Zdolność do pracy</h3>{compliance.map((row) => <p key={`${str(row.item_kind)}-${str(row.id)}`}><strong>{str(row.item_type)}</strong> · ważne do {dateLabel(row.valid_until)} · <StatusChip status={row.valid_until && String(row.valid_until) < data.referenceDate ? "expired" : row.status} /></p>)}{!compliance.length ? <p className={styles.subtle}>Brak badań, BHP i uprawnień.</p> : null}</section>
        <section className={styles.profileSection}><h3>Urlopy i czas pracy</h3><p>Ostatnie wpisy czasu: {timesheets.slice(0, 5).map((row) => `${dateLabel(row.work_date)} — ${num(row.hours)} h`).join(" · ") || "brak"}</p><p>Ostatnie absencje: {leaves.slice(0, 4).map((row) => `${dateLabel(row.date_from)}–${dateLabel(row.date_to)} (${str(row.status)})`).join(" · ") || "brak"}</p></section>
        <section className={styles.profileSection}><h3>Dokumenty</h3>{documents.map((row) => <p key={String(row.id)}><strong>{str(row.document_type)}</strong> · {str(row.document_number)} · ważne do {dateLabel(row.valid_until)}</p>)}{!documents.length ? <p className={styles.subtle}>Brak przypisanych dokumentów HR.</p> : null}</section>
        <section className={styles.profileSection}><h3>Sprzęt i ŚOI</h3>{assets.map((row) => <div className={styles.member} key={String(row.id)}><div><strong>{str(row.description)}</strong><div className={styles.subtle}>{str(row.asset_type)} · wydano {dateLabel(String(row.issued_at).slice(0, 10))}{row.returned_at ? ` · zwrócono ${dateLabel(String(row.returned_at).slice(0, 10))}` : ""}</div></div>{canWrite && !row.returned_at ? <button className={styles.buttonSecondary} disabled={pending} onClick={() => perform("issued_asset_return", { assetId: row.id, conditionIn: "dobry" }, "Sprzęt został zwrócony.")}>Zwróć</button> : null}</div>)}{canWrite ? <form className={styles.form} onSubmit={submit("issued_asset_create", "Sprzęt został wydany pracownikowi.")}><input type="hidden" name="employeeId" value={employeeId} /><div className={styles.formGrid}><label>Rodzaj<select name="assetType" defaultValue="ppe"><option value="ppe">ŚOI</option><option value="tool">Narzędzie</option><option value="device">Urządzenie</option><option value="other">Inne</option></select></label><label>Opis<input name="description" required placeholder="Kask / Hilti TE 30 / detektor" /></label></div><button className={styles.buttonSecondary} disabled={pending}><PackageCheck size={15} /> Wydaj</button></form> : null}</section>

        {canWrite ? <section className={styles.profileSection} data-hr-employee-edit>
          <h3>Edytuj kartę</h3>
          <form className={styles.form} onSubmit={submit("employee_update", "Dane pracownika zostały zaktualizowane.")}><input type="hidden" name="employeeId" value={employeeId} /><div className={styles.formGrid}><label>Imię<input name="firstName" defaultValue={str(employee.first_name, "")} required /></label><label>Nazwisko<input name="lastName" defaultValue={str(employee.last_name, "")} required /></label><label>Numer<input name="employeeNumber" defaultValue={str(employee.employee_number, "")} /></label><label>Telefon<input name="phone" defaultValue={str(employee.phone, "")} /></label><label>E-mail<input name="email" type="email" defaultValue={str(employee.email, "")} /></label><label>Kontakt awaryjny<input name="emergencyContactName" defaultValue={str(employee.emergency_contact_name, "")} /></label><label>Telefon awaryjny<input name="emergencyContactPhone" defaultValue={str(employee.emergency_contact_phone, "")} /></label><label>Notatki<input name="notes" defaultValue={str(employee.notes, "")} /></label></div><button className={styles.button} disabled={pending}>Zapisz dane</button></form>
          <FormBlock title="Nowe warunki zatrudnienia"><form className={styles.form} onSubmit={submit("employment_create", "Nowy okres zatrudnienia został zapisany.")}><input type="hidden" name="employeeId" value={employeeId} /><div className={styles.formGrid}><label>Forma<select name="employmentType" defaultValue="employment_contract"><option value="employment_contract">Umowa o pracę</option><option value="contract">Umowa cywilna</option><option value="b2b">B2B</option></select></label><label>Stanowisko<input name="position" /></label><label>Od<input name="validFrom" type="date" defaultValue={data.referenceDate} required /></label><label>Do<input name="validTo" type="date" /></label><label>Etat<input name="fullTimeEquivalent" inputMode="decimal" /></label></div>{canManagePayroll ? <HrCompensationFields150 /> : <p className={styles.fieldHint}>Nowy okres zostanie zapisany bez danych płacowych.</p>}<button className={styles.buttonSecondary} disabled={pending}>Dodaj okres</button></form></FormBlock>
          <FormBlock title="Przypisz do inwestycji"><form className={styles.form} onSubmit={submit("assignment_create", "Pracownik został przypisany do inwestycji.")}><input type="hidden" name="employeeId" value={employeeId} /><label>Inwestycja<select name="projectId" required><option value="">Wybierz</option>{data.projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{str(row.name)}</option>)}</select></label><div className={styles.formGrid}><label>Rola<input name="role" required /></label><label>Zaangażowanie %<input name="allocationPercent" defaultValue="100" /></label><label>Od<input name="dateFrom" type="date" defaultValue={data.referenceDate} /></label><label>Do<input name="dateTo" type="date" /></label></div><button className={styles.buttonSecondary} disabled={pending}>Przypisz</button></form></FormBlock>
        </section> : null}
      </div>
    </aside>
  </div>;
}
