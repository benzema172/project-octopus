"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Download, Filter, Layers3, LoaderCircle, MapPin, Pencil, Plus, RotateCcw, Search, UsersRound, X } from "lucide-react";
import { HrTimesheetEntryEditor159 } from "./hr-timesheet-entry-editor-159";
import { HrWorkCost160 } from "./hr-work-cost-160";
import styles from "./hr-time-records-400.module.css";

type Row = Record<string, unknown>;
type ViewMode = "day" | "week" | "month" | "history";
type DetailFocus = { employeeId: string; workDate: string };
type RangeResponse = { ok?: boolean; rows?: Row[]; count?: number; offset?: number; limit?: number; hasMore?: boolean; error?: string };
type BulkResponse = { ok?: boolean; inserted?: number; updated?: number; skippedExisting?: number; skippedLeave?: number; skippedConflict?: number; affected?: number; error?: string };

type Props = {
  workspaceId: string;
  referenceDate: string;
  employees: Row[];
  projects: Row[];
  timesheets: Row[];
  assignments: Row[];
  leaves: Row[];
  canWrite: boolean;
  canViewPayroll: boolean;
  initialEmployeeId?: string | null;
  onClearEmployeeFocus?: () => void;
};

const weekdays = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
const statuses: Array<[string, string]> = [["", "Wszystkie statusy"], ["draft", "Szkic"], ["pending", "Oczekuje"], ["submitted", "Do decyzji"], ["review", "Weryfikacja"], ["approved", "Zatwierdzony"], ["rejected", "Odrzucony"]];

function str(value: unknown, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function num(value: unknown, digits = 1) { const parsed = Number(value ?? 0); return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0); }
function money(value: unknown) { const parsed = Number(value ?? 0); return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(Number.isFinite(parsed) ? parsed : 0); }
function employeeName(row?: Row | null) { return row ? `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number, "Pracownik") : "Pracownik"; }
function parseIso(value: string) { const [year, month, day] = value.split("-").map(Number); return new Date(Date.UTC(year, Math.max(0, month - 1), day || 1)); }
function iso(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }
function addDays(value: string, amount: number) { const date = parseIso(value); date.setUTCDate(date.getUTCDate() + amount); return iso(date); }
function addMonths(value: string, amount: number) { const date = parseIso(value); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount); return iso(date); }
function startOfWeek(value: string) { const date = parseIso(value); const offset = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - offset); return iso(date); }
function startOfMonth(value: string) { return `${value.slice(0, 7)}-01`; }
function endOfMonth(value: string) { const date = parseIso(startOfMonth(value)); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0); return iso(date); }
function datesBetween(from: string, to: string) { const rows: string[] = []; for (let current = from; current <= to; current = addDays(current, 1)) rows.push(current); return rows; }
function entryHours(row: Row) { return Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0); }
function inRange(date: string, from: unknown, to: unknown) { return (from ? String(from).slice(0, 10) : "0000-01-01") <= date && date <= (to ? String(to).slice(0, 10) : "9999-12-31"); }
function dateLabel(value: string, options: Intl.DateTimeFormatOptions = {}) { return parseIso(value).toLocaleDateString("pl-PL", { timeZone: "UTC", ...options }); }
function compactDate(value: string) { return dateLabel(value, { day: "2-digit", month: "2-digit" }); }
function statusLabel(value: unknown) { const key = String(value ?? ""); return statuses.find(([id]) => id === key)?.[1] ?? key || "—"; }
function statusClass(value: unknown) { const key = String(value ?? ""); return ["approved"].includes(key) ? styles.statusOk : ["rejected"].includes(key) ? styles.statusBad : ["submitted", "pending", "review"].includes(key) ? styles.statusWarn : styles.statusMuted; }

function modeRange(mode: ViewMode, anchorDate: string, historyFrom: string, historyTo: string) {
  if (mode === "day") return { from: anchorDate, to: anchorDate };
  if (mode === "week") { const from = startOfWeek(anchorDate); return { from, to: addDays(from, 6) }; }
  if (mode === "month") return { from: startOfMonth(anchorDate), to: endOfMonth(anchorDate) };
  return { from: historyFrom, to: historyTo };
}

export function HrTimeRecords400({ workspaceId, referenceDate, employees, projects, timesheets, assignments, leaves, canWrite, canViewPayroll, initialEmployeeId = null, onClearEmployeeFocus }: Props) {
  const initialEmployee = initialEmployeeId ? employees.find((row) => String(row.id) === String(initialEmployeeId)) ?? null : null;
  const [mode, setMode] = useState<ViewMode>(() => initialEmployee ? "month" : "day");
  const [anchorDate, setAnchorDate] = useState(referenceDate);
  const [employeeFilter, setEmployeeFilter] = useState(initialEmployee ? String(initialEmployee.id) : "");
  const [historyFrom, setHistoryFrom] = useState(`${referenceDate.slice(0, 4)}-01-01`);
  const [historyTo, setHistoryTo] = useState(referenceDate);
  const [historyEmployeeId, setHistoryEmployeeId] = useState(initialEmployee ? String(initialEmployee.id) : "");
  const [historyProjectId, setHistoryProjectId] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [entries, setEntries] = useState<Row[]>(timesheets);
  const [rangeCount, setRangeCount] = useState(timesheets.length);
  const [loading, setLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailFocus, setDetailFocus] = useState<DetailFocus | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEmployeeIds, setBulkEmployeeIds] = useState<string[]>(initialEmployee ? [String(initialEmployee.id)] : []);
  const [bulkFrom, setBulkFrom] = useState(referenceDate);
  const [bulkTo, setBulkTo] = useState(referenceDate);
  const [bulkProjectId, setBulkProjectId] = useState("");
  const [bulkHours, setBulkHours] = useState("8");
  const [bulkOvertime, setBulkOvertime] = useState("0");
  const [bulkMode, setBulkMode] = useState<"fill_missing" | "replace_single">("fill_missing");
  const [bulkWeekdaysOnly, setBulkWeekdaysOnly] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const activeEmployees = useMemo(() => employees.filter((row) => row.status === "active"), [employees]);
  const employeeById = useMemo(() => new Map(employees.map((row) => [String(row.id), row])), [employees]);
  const projectById = useMemo(() => new Map(projects.map((row) => [String(row.id), row])), [projects]);
  const range = useMemo(() => modeRange(mode, anchorDate, historyFrom, historyTo), [mode, anchorDate, historyFrom, historyTo]);
  const historyPageSize = 250;

  const loadRange = useCallback(async () => {
    const params = new URLSearchParams({ workspaceId, from: range.from, to: range.to });
    if (mode === "history") {
      if (historyEmployeeId) params.set("employeeId", historyEmployeeId);
      if (historyProjectId) params.set("projectId", historyProjectId);
      if (historyStatus) params.set("status", historyStatus);
      params.set("offset", String(historyPage * historyPageSize));
      params.set("limit", String(historyPageSize));
    } else {
      params.set("limit", "1000");
    }
    setLoading(true);
    setRangeError(null);
    try {
      const response = await fetch(`/api/company/hr/timesheet-range?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as RangeResponse;
      if (!response.ok) throw new Error(result.error ?? "Nie udało się pobrać ewidencji czasu.");
      setEntries(result.rows ?? []);
      setRangeCount(Number(result.count ?? (result.rows ?? []).length));
    } catch (reason) {
      setRangeError(reason instanceof Error ? reason.message : "Nie udało się pobrać ewidencji czasu.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, range.from, range.to, mode, historyEmployeeId, historyProjectId, historyStatus, historyPage]);

  useEffect(() => { void loadRange(); }, [loadRange, reloadKey]);

  const entriesByEmployeeDate = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of entries) {
      const key = `${String(row.employee_id)}|${String(row.work_date).slice(0, 10)}`;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [entries]);
  const assignmentsByEmployee = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of assignments) {
      const key = String(row.employee_id);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [assignments]);
  const leavesByEmployee = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of leaves) {
      if (String(row.status) !== "approved") continue;
      const key = String(row.employee_id);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  }, [leaves]);

  const visibleEmployees = useMemo(() => employeeFilter ? activeEmployees.filter((row) => String(row.id) === employeeFilter) : activeEmployees, [activeEmployees, employeeFilter]);
  const plannedProjects = useCallback((employeeId: string, date: string) => Array.from(new Set((assignmentsByEmployee.get(employeeId) ?? []).filter((row) => inRange(date, row.date_from, row.date_to)).map((row) => String(row.project_id ?? "")).filter(Boolean))), [assignmentsByEmployee]);
  const approvedLeave = useCallback((employeeId: string, date: string) => (leavesByEmployee.get(employeeId) ?? []).find((row) => inRange(date, row.date_from, row.date_to)) ?? null, [leavesByEmployee]);
  const actualProjects = useCallback((dayEntries: Row[]) => Array.from(new Set(dayEntries.map((row) => row.project_id ? String(row.project_id) : "").filter(Boolean))), []);
  const projectNames = useCallback((ids: string[]) => ids.map((id) => str(projectById.get(id)?.name, "Inwestycja")).join(" / "), [projectById]);
  const hasPlanMismatch = useCallback((employeeId: string, date: string, dayEntries: Row[]) => {
    const planned = plannedProjects(employeeId, date);
    const actual = actualProjects(dayEntries);
    if (!planned.length || !actual.length) return false;
    return actual.some((id) => !planned.includes(id));
  }, [actualProjects, plannedProjects]);

  const movePeriod = (direction: -1 | 1) => {
    setDetailFocus(null);
    if (mode === "day") setAnchorDate((value) => addDays(value, direction));
    if (mode === "week") setAnchorDate((value) => addDays(value, direction * 7));
    if (mode === "month") setAnchorDate((value) => addMonths(value, direction));
  };
  const changeMode = (next: ViewMode) => {
    setMode(next);
    setDetailFocus(null);
    if (next !== "history") setHistoryPage(0);
  };
  const jump = (days: number) => { setAnchorDate((value) => addDays(value, days)); setDetailFocus(null); };
  const openBulkForCurrentRange = () => {
    const currentRange = modeRange(mode === "history" ? "week" : mode, anchorDate, historyFrom, historyTo);
    setBulkFrom(currentRange.from);
    setBulkTo(currentRange.to);
    setBulkEmployeeIds(employeeFilter ? [employeeFilter] : []);
    setBulkMessage(null);
    setBulkError(null);
    setBulkOpen(true);
  };
  const closeDetail = () => { setDetailFocus(null); setReloadKey((value) => value + 1); };
  const clearEmployeeFocus = () => { setEmployeeFilter(""); setHistoryEmployeeId(""); onClearEmployeeFocus?.(); };

  const submitBulk = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bulkEmployeeIds.length) { setBulkError("Wybierz co najmniej jednego pracownika."); return; }
    setBulkBusy(true); setBulkError(null); setBulkMessage(null);
    try {
      const response = await fetch("/api/company/hr/timesheet-bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, employeeIds: bulkEmployeeIds, from: bulkFrom, to: bulkTo, projectId: bulkProjectId || null, hours: bulkHours, overtimeHours: bulkOvertime, weekdaysOnly: bulkWeekdaysOnly, mode: bulkMode }) });
      const result = await response.json().catch(() => ({})) as BulkResponse;
      if (!response.ok) throw new Error(result.error ?? "Nie udało się wykonać operacji masowej.");
      setBulkMessage(`Zapisano ${Number(result.affected ?? 0)} wpisów: ${Number(result.inserted ?? 0)} nowych, ${Number(result.updated ?? 0)} poprawionych. Pominięto: ${Number(result.skippedExisting ?? 0)} istniejących, ${Number(result.skippedLeave ?? 0)} urlopów, ${Number(result.skippedConflict ?? 0)} dni z wieloma wpisami.`);
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setBulkError(reason instanceof Error ? reason.message : "Nie udało się wykonać operacji masowej.");
    } finally { setBulkBusy(false); }
  };

  const currentTitle = mode === "day" ? dateLabel(anchorDate, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    : mode === "week" ? `${compactDate(startOfWeek(anchorDate))} – ${compactDate(addDays(startOfWeek(anchorDate), 6))}`
      : mode === "month" ? dateLabel(startOfMonth(anchorDate), { month: "long", year: "numeric" })
        : `${compactDate(historyFrom)} – ${compactDate(historyTo)}`;
  const totalHours = entries.reduce((sum, row) => sum + entryHours(row), 0);
  const weekDates = useMemo(() => { const from = startOfWeek(anchorDate); return datesBetween(from, addDays(from, 6)); }, [anchorDate]);
  const monthDays = useMemo(() => {
    const first = parseIso(startOfMonth(anchorDate));
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    first.setUTCDate(first.getUTCDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => { const date = new Date(first); date.setUTCDate(first.getUTCDate() + index); return iso(date); });
  }, [anchorDate]);
  const monthKey = anchorDate.slice(0, 7);
  const detailEmployee = detailFocus ? employeeById.get(detailFocus.employeeId) ?? null : null;
  const detailEntries = detailFocus ? entriesByEmployeeDate.get(`${detailFocus.employeeId}|${detailFocus.workDate}`) ?? [] : [];
  const detailInitialProjectId = detailEntries.find((row) => row.project_id)?.project_id ? String(detailEntries.find((row) => row.project_id)?.project_id) : null;

  return <div className={styles.root} data-hr-time-400="1">
    <section className={styles.headerCard}>
      <div className={styles.heading}>
        <div><p className={styles.kicker}>Czas pracy 4.0</p><h2>Ewidencja, lokalizacja i historia pracy</h2><p>Przechodź dzień po dniu, kontroluj tydzień, przeglądaj miesiąc albo wyszukuj dowolny historyczny wpis.</p></div>
        <div className={styles.summary}><span><Clock3 size={15} /> {num(totalHours)} h</span><span>{loading ? <LoaderCircle size={14} className={styles.spin} /> : <Check size={14} />} {mode === "history" ? `${rangeCount} wpisów` : currentTitle}</span></div>
      </div>

      <div className={styles.modeBar}>
        <div className={styles.modes}>{(["day", "week", "month", "history"] as ViewMode[]).map((item) => <button key={item} type="button" className={mode === item ? styles.modeActive : styles.mode} onClick={() => changeMode(item)}>{item === "day" ? "Dzień" : item === "week" ? "Tydzień" : item === "month" ? "Miesiąc" : "Historia"}</button>)}</div>
        {mode !== "history" ? <div className={styles.periodNav}>
          <button type="button" className={styles.iconButton} onClick={() => movePeriod(-1)} aria-label="Poprzedni okres"><ChevronLeft size={17} /></button>
          <button type="button" className={styles.todayButton} onClick={() => setAnchorDate(referenceDate)}>Dzisiaj</button>
          <button type="button" className={styles.iconButton} onClick={() => movePeriod(1)} aria-label="Następny okres"><ChevronRight size={17} /></button>
          <input className={styles.dateInput} type="date" value={anchorDate} onChange={(event) => event.target.value && setAnchorDate(event.target.value)} aria-label="Przejdź do daty" />
          <button type="button" className={styles.jumpButton} onClick={() => jump(-7)}>−7 dni</button>
          <button type="button" className={styles.jumpButton} onClick={() => jump(-30)}>−30 dni</button>
        </div> : null}
        <div className={styles.contextActions}>
          {initialEmployeeId || employeeFilter ? <button type="button" className={styles.secondary} onClick={clearEmployeeFocus}><RotateCcw size={14} /> Wszyscy</button> : null}
          {canWrite ? <button type="button" className={styles.primary} onClick={openBulkForCurrentRange}><Layers3 size={15} /> Edycja zakresowa</button> : null}
        </div>
      </div>

      {mode !== "history" ? <div className={styles.filtersRow}>
        <label><span>Pracownik</span><select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="">Wszyscy aktywni</option>{activeEmployees.map((employee) => <option key={String(employee.id)} value={String(employee.id)}>{employeeName(employee)}</option>)}</select></label>
        <div className={styles.rangeCaption}><CalendarDays size={15} /><strong>{currentTitle}</strong><span>·</span><span>{range.from} → {range.to}</span></div>
      </div> : null}
      {rangeError ? <div className={styles.error}>{rangeError}</div> : null}
    </section>

    {mode === "day" ? <DayView date={anchorDate} employees={visibleEmployees} projects={projects} entriesByEmployeeDate={entriesByEmployeeDate} plannedProjects={plannedProjects} projectNames={projectNames} actualProjects={actualProjects} approvedLeave={approvedLeave} hasPlanMismatch={hasPlanMismatch} workspaceId={workspaceId} canWrite={canWrite} onChanged={() => setReloadKey((value) => value + 1)} onOpenDetails={(employeeId) => setDetailFocus({ employeeId, workDate: anchorDate })} /> : null}
    {mode === "week" ? <WeekView dates={weekDates} employees={visibleEmployees} projects={projects} entriesByEmployeeDate={entriesByEmployeeDate} plannedProjects={plannedProjects} projectNames={projectNames} approvedLeave={approvedLeave} hasPlanMismatch={hasPlanMismatch} workspaceId={workspaceId} canWrite={canWrite} onChanged={() => setReloadKey((value) => value + 1)} onOpenDetails={(employeeId, workDate) => setDetailFocus({ employeeId, workDate })} /> : null}
    {mode === "month" ? <MonthView monthKey={monthKey} days={monthDays} employees={visibleEmployees} selectedEmployeeId={employeeFilter} entriesByEmployeeDate={entriesByEmployeeDate} plannedProjects={plannedProjects} projectNames={projectNames} approvedLeave={approvedLeave} hasPlanMismatch={hasPlanMismatch} referenceDate={referenceDate} onOpenDay={(date, employeeId) => { if (employeeId) setDetailFocus({ employeeId, workDate: date }); else { setAnchorDate(date); setMode("day"); } }} /> : null}
    {mode === "history" ? <HistoryView rows={entries} count={rangeCount} page={historyPage} pageSize={historyPageSize} employees={employees} projects={projects} canViewPayroll={canViewPayroll} from={historyFrom} to={historyTo} employeeId={historyEmployeeId} projectId={historyProjectId} status={historyStatus} loading={loading} onFrom={(value) => { setHistoryFrom(value); setHistoryPage(0); }} onTo={(value) => { setHistoryTo(value); setHistoryPage(0); }} onEmployee={(value) => { setHistoryEmployeeId(value); setHistoryPage(0); }} onProject={(value) => { setHistoryProjectId(value); setHistoryPage(0); }} onStatus={(value) => { setHistoryStatus(value); setHistoryPage(0); }} onReset={() => { setHistoryFrom(`${referenceDate.slice(0, 4)}-01-01`); setHistoryTo(referenceDate); setHistoryEmployeeId(""); setHistoryProjectId(""); setHistoryStatus(""); setHistoryPage(0); }} onPage={setHistoryPage} onEdit={(row) => setDetailFocus({ employeeId: String(row.employee_id), workDate: String(row.work_date).slice(0, 10) })} workspaceId={workspaceId} /> : null}

    {detailFocus && detailEmployee && typeof document !== "undefined" ? createPortal(<div className={styles.modalLayer}>
      <button type="button" className={styles.backdrop} onClick={closeDetail} aria-label="Zamknij edycję dnia" />
      <section className={styles.detailModal} role="dialog" aria-modal="true" aria-labelledby="hr-time-400-detail-title">
        <header className={styles.detailHeader}><div><span>Pełna korekta historyczna</span><h3 id="hr-time-400-detail-title">{employeeName(detailEmployee)} · {dateLabel(detailFocus.workDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h3><p>Zmiana zatwierdzonego wpisu automatycznie cofnie go do ponownej decyzji i pozostawi ślad w audycie.</p></div><button type="button" className={styles.close} onClick={closeDetail}><X size={18} /></button></header>
        <div className={styles.detailBody}><HrWorkCost160 workspaceId={workspaceId} referenceDate={detailFocus.workDate} employees={employees} projects={projects} canWrite={canWrite} canViewPayroll={canViewPayroll} fixedEmployeeId={detailFocus.employeeId} fixedWorkDate={detailFocus.workDate} initialProjectId={detailInitialProjectId} embedded /></div>
      </section>
    </div>, document.body) : null}

    {bulkOpen && typeof document !== "undefined" ? createPortal(<div className={styles.modalLayer}>
      <button type="button" className={styles.backdrop} onClick={() => !bulkBusy && setBulkOpen(false)} aria-label="Zamknij edycję zakresową" />
      <section className={styles.bulkModal} role="dialog" aria-modal="true" aria-labelledby="hr-time-400-bulk-title">
        <header className={styles.detailHeader}><div><span>Edycja zakresowa</span><h3 id="hr-time-400-bulk-title">Przypisz pracowników do inwestycji i godzin</h3><p>Jednym zapisem uzupełnisz serię dni. Zatwierdzone urlopy są pomijane, a dni z wieloma istniejącymi wpisami nie są nadpisywane automatycznie.</p></div><button type="button" className={styles.close} disabled={bulkBusy} onClick={() => setBulkOpen(false)}><X size={18} /></button></header>
        <form className={styles.bulkBody} onSubmit={submitBulk}>
          <div className={styles.bulkDates}><label>Od<input type="date" value={bulkFrom} onChange={(event) => setBulkFrom(event.target.value)} required /></label><label>Do<input type="date" value={bulkTo} onChange={(event) => setBulkTo(event.target.value)} required /></label><label>Inwestycja<select value={bulkProjectId} onChange={(event) => setBulkProjectId(event.target.value)}><option value="">Koszt ogólny / bez inwestycji</option>{projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{str(project.name)}</option>)}</select></label><label>Godziny<input value={bulkHours} onChange={(event) => setBulkHours(event.target.value)} inputMode="decimal" /></label><label>Nadgodziny<input value={bulkOvertime} onChange={(event) => setBulkOvertime(event.target.value)} inputMode="decimal" /></label></div>
          <div className={styles.bulkMode}><label><input type="radio" checked={bulkMode === "fill_missing"} onChange={() => setBulkMode("fill_missing")} /> <span><strong>Uzupełnij tylko puste dni</strong><small>Najbezpieczniejsze do planowania całej brygady.</small></span></label><label><input type="radio" checked={bulkMode === "replace_single"} onChange={() => setBulkMode("replace_single")} /> <span><strong>Zastąp pojedynczy wpis dnia</strong><small>Jeżeli dzień ma więcej niż jeden wpis, system go pominie.</small></span></label><label className={styles.checkline}><input type="checkbox" checked={bulkWeekdaysOnly} onChange={(event) => setBulkWeekdaysOnly(event.target.checked)} /> Tylko polskie dni robocze</label></div>
          <div className={styles.bulkEmployees}><div className={styles.bulkEmployeeHeader}><strong>Pracownicy ({bulkEmployeeIds.length})</strong><div><button type="button" onClick={() => setBulkEmployeeIds(activeEmployees.map((row) => String(row.id)))}>Zaznacz wszystkich</button><button type="button" onClick={() => setBulkEmployeeIds([])}>Wyczyść</button></div></div><div className={styles.employeeChecks}>{activeEmployees.map((employee) => { const id = String(employee.id); return <label key={id}><input type="checkbox" checked={bulkEmployeeIds.includes(id)} onChange={(event) => setBulkEmployeeIds((current) => event.target.checked ? [...current, id] : current.filter((value) => value !== id))} /><span>{employeeName(employee)}</span></label>; })}</div></div>
          {bulkMessage ? <div className={styles.success}>{bulkMessage}</div> : null}{bulkError ? <div className={styles.error}>{bulkError}</div> : null}
          <div className={styles.bulkActions}><button type="button" className={styles.secondary} disabled={bulkBusy} onClick={() => setBulkOpen(false)}>Zamknij</button><button type="submit" className={styles.primary} disabled={bulkBusy || !bulkEmployeeIds.length}>{bulkBusy ? <LoaderCircle size={15} className={styles.spin} /> : <Layers3 size={15} />} Zastosuj do zakresu</button></div>
        </form>
      </section>
    </div>, document.body) : null}
  </div>;
}

function DayView({ date, employees, projects, entriesByEmployeeDate, plannedProjects, projectNames, actualProjects, approvedLeave, hasPlanMismatch, workspaceId, canWrite, onChanged, onOpenDetails }: { date: string; employees: Row[]; projects: Row[]; entriesByEmployeeDate: Map<string, Row[]>; plannedProjects: (employeeId: string, date: string) => string[]; projectNames: (ids: string[]) => string; actualProjects: (rows: Row[]) => string[]; approvedLeave: (employeeId: string, date: string) => Row | null; hasPlanMismatch: (employeeId: string, date: string, rows: Row[]) => boolean; workspaceId: string; canWrite: boolean; onChanged: () => void; onOpenDetails: (employeeId: string) => void }) {
  return <section className={styles.panel}><header className={styles.panelHeader}><div><p className={styles.kicker}>Dzień</p><h3>Ekipa i lokalizacja</h3></div><span className={styles.help}>Plan ≠ wykonanie jest zaznaczane automatycznie.</span></header><div className={styles.dayTable}><div className={styles.dayHead}><span>Pracownik</span><span>Plan</span><span>Wykonanie i godziny</span><span>Razem</span></div>{employees.map((employee) => { const employeeId = String(employee.id); const dayEntries = entriesByEmployeeDate.get(`${employeeId}|${date}`) ?? []; const planned = plannedProjects(employeeId, date); const actual = actualProjects(dayEntries); const leave = approvedLeave(employeeId, date); const mismatch = hasPlanMismatch(employeeId, date, dayEntries); return <div className={styles.dayRow} key={employeeId}><div className={styles.employeeCell}><strong>{employeeName(employee)}</strong><button type="button" onClick={() => onOpenDetails(employeeId)}>Pełne szczegóły <ArrowRight size={12} /></button></div><div className={styles.planCell}>{leave ? <span className={styles.leaveChip}>Nieobecność · {str(leave.leave_type)}</span> : planned.length ? <><strong>{projectNames(planned)}</strong><small>planowane przypisanie</small></> : <span className={styles.muted}>Brak planu</span>}{mismatch ? <span className={styles.mismatch}>Plan ≠ wykonanie</span> : null}</div><div className={styles.editorCell}><HrTimesheetEntryEditor159 workspaceId={workspaceId} employeeId={employeeId} employeeName={employeeName(employee)} workDate={date} projects={projects} entries={dayEntries} canWrite={canWrite} variant="inline" suggestedProjectId={planned[0] ?? ""} onChanged={onChanged} />{actual.length ? <small className={styles.actualLabel}>Wykonanie: {projectNames(actual)}</small> : null}</div><div className={styles.totalCell}><strong>{num(dayEntries.reduce((sum, row) => sum + entryHours(row), 0))} h</strong></div></div>; })}{!employees.length ? <div className={styles.empty}>Brak aktywnych pracowników dla filtra.</div> : null}</div></section>;
}

function WeekView({ dates, employees, projects, entriesByEmployeeDate, plannedProjects, projectNames, approvedLeave, hasPlanMismatch, workspaceId, canWrite, onChanged, onOpenDetails }: { dates: string[]; employees: Row[]; projects: Row[]; entriesByEmployeeDate: Map<string, Row[]>; plannedProjects: (employeeId: string, date: string) => string[]; projectNames: (ids: string[]) => string; approvedLeave: (employeeId: string, date: string) => Row | null; hasPlanMismatch: (employeeId: string, date: string, rows: Row[]) => boolean; workspaceId: string; canWrite: boolean; onChanged: () => void; onOpenDetails: (employeeId: string, date: string) => void }) {
  return <section className={styles.panel}><header className={styles.panelHeader}><div><p className={styles.kicker}>Tydzień</p><h3>Główny ekran korekt</h3></div><span className={styles.help}>Kliknij dowolną komórkę, aby zmienić również historyczny dzień.</span></header><div className={styles.weekScroll}><table className={styles.weekTable}><thead><tr><th>Pracownik</th>{dates.map((date, index) => <th key={date} className={index > 4 ? styles.weekendHead : undefined}><span>{weekdays[index]}</span><strong>{compactDate(date)}</strong></th>)}<th>Razem</th></tr></thead><tbody>{employees.map((employee) => { const employeeId = String(employee.id); const total = dates.reduce((sum, date) => sum + (entriesByEmployeeDate.get(`${employeeId}|${date}`) ?? []).reduce((value, row) => value + entryHours(row), 0), 0); return <tr key={employeeId}><td><strong>{employeeName(employee)}</strong></td>{dates.map((date, index) => { const dayEntries = entriesByEmployeeDate.get(`${employeeId}|${date}`) ?? []; const planned = plannedProjects(employeeId, date); const leave = approvedLeave(employeeId, date); const mismatch = hasPlanMismatch(employeeId, date, dayEntries); return <td key={date} className={`${styles.weekCell} ${index > 4 ? styles.weekendCell : ""}`}>{leave ? <button type="button" className={styles.leaveCell} onClick={() => onOpenDetails(employeeId, date)}><strong>Nieobecność</strong><span>{str(leave.leave_type)}</span></button> : <><HrTimesheetEntryEditor159 workspaceId={workspaceId} employeeId={employeeId} employeeName={employeeName(employee)} workDate={date} projects={projects} entries={dayEntries} canWrite={canWrite} variant="cell" suggestedProjectId={planned[0] ?? ""} onChanged={onChanged} onOpenDetails={() => onOpenDetails(employeeId, date)} />{planned.length ? <small className={styles.weekPlan} title={`Plan: ${projectNames(planned)}`}>Plan: {projectNames(planned)}</small> : null}{mismatch ? <span className={styles.mismatchSmall}>≠ plan</span> : null}</>}</td>; })}<td className={styles.weekTotal}><strong>{num(total)} h</strong></td></tr>; })}</tbody></table></div></section>;
}

function MonthView({ monthKey, days, employees, selectedEmployeeId, entriesByEmployeeDate, plannedProjects, projectNames, approvedLeave, hasPlanMismatch, referenceDate, onOpenDay }: { monthKey: string; days: string[]; employees: Row[]; selectedEmployeeId: string; entriesByEmployeeDate: Map<string, Row[]>; plannedProjects: (employeeId: string, date: string) => string[]; projectNames: (ids: string[]) => string; approvedLeave: (employeeId: string, date: string) => Row | null; hasPlanMismatch: (employeeId: string, date: string, rows: Row[]) => boolean; referenceDate: string; onOpenDay: (date: string, employeeId?: string) => void }) {
  const selectedEmployee = selectedEmployeeId ? employees.find((row) => String(row.id) === selectedEmployeeId) ?? null : null;
  return <section className={styles.panel}><header className={styles.panelHeader}><div><p className={styles.kicker}>Miesiąc</p><h3>{selectedEmployee ? `Kalendarz — ${employeeName(selectedEmployee)}` : "Kalendarz całej ekipy"}</h3></div><span className={styles.help}>{selectedEmployee ? "Godziny, lokalizacja, urlopy i rozbieżności planu." : "Kliknij dzień, aby przejść do dziennej korekty całej ekipy."}</span></header><div className={styles.monthGrid}>{weekdays.map((label) => <div className={styles.weekday} key={label}>{label}</div>)}{days.map((date) => { const outside = date.slice(0, 7) !== monthKey; const today = date === referenceDate; if (selectedEmployee) { const id = String(selectedEmployee.id); const rows = entriesByEmployeeDate.get(`${id}|${date}`) ?? []; const leave = approvedLeave(id, date); const planned = plannedProjects(id, date); const mismatch = hasPlanMismatch(id, date, rows); const hours = rows.reduce((sum, row) => sum + entryHours(row), 0); const actualIds = Array.from(new Set(rows.map((row) => row.project_id ? String(row.project_id) : "").filter(Boolean))); return <button type="button" key={date} className={`${styles.monthDay} ${outside ? styles.outside : ""} ${today ? styles.today : ""}`} onClick={() => onOpenDay(date, id)}><span className={styles.dayNumber}>{Number(date.slice(8))}</span>{leave ? <span className={styles.monthAbsence}>Urlop / nieobecność</span> : hours > 0 ? <><strong>{num(hours)} h</strong><small>{actualIds.length ? projectNames(actualIds) : "Koszt ogólny"}</small></> : planned.length ? <><span className={styles.monthMissing}>Brak wpisu</span><small>Plan: {projectNames(planned)}</small></> : <span className={styles.monthEmpty}>—</span>}{mismatch ? <span className={styles.mismatchSmall}>≠ plan</span> : null}</button>; }
    const summary = employees.reduce((acc, employee) => { const id = String(employee.id); const rows = entriesByEmployeeDate.get(`${id}|${date}`) ?? []; const leave = approvedLeave(id, date); const planned = plannedProjects(id, date); if (leave) acc.absence += 1; else if (rows.length) { acc.work += 1; if (hasPlanMismatch(id, date, rows)) acc.conflict += 1; } else if (planned.length) acc.missing += 1; return acc; }, { work: 0, absence: 0, missing: 0, conflict: 0 }); return <button type="button" key={date} className={`${styles.monthDay} ${outside ? styles.outside : ""} ${today ? styles.today : ""}`} onClick={() => onOpenDay(date)}><span className={styles.dayNumber}>{Number(date.slice(8))}</span><div className={styles.monthSummary}>{summary.work ? <span className={styles.workCount}>{summary.work} praca</span> : null}{summary.absence ? <span className={styles.absenceCount}>{summary.absence} urlop</span> : null}{summary.missing ? <span className={styles.missingCount}>{summary.missing} brak</span> : null}{summary.conflict ? <span className={styles.conflictCount}>{summary.conflict} ≠ plan</span> : null}</div></button>; })}</div></section>;
}

function HistoryView({ rows, count, page, pageSize, employees, projects, canViewPayroll, from, to, employeeId, projectId, status, loading, onFrom, onTo, onEmployee, onProject, onStatus, onReset, onPage, onEdit, workspaceId }: { rows: Row[]; count: number; page: number; pageSize: number; employees: Row[]; projects: Row[]; canViewPayroll: boolean; from: string; to: string; employeeId: string; projectId: string; status: string; loading: boolean; onFrom: (value: string) => void; onTo: (value: string) => void; onEmployee: (value: string) => void; onProject: (value: string) => void; onStatus: (value: string) => void; onReset: () => void; onPage: (value: number) => void; onEdit: (row: Row) => void; workspaceId: string }) {
  const employeeById = new Map(employees.map((row) => [String(row.id), row])); const projectById = new Map(projects.map((row) => [String(row.id), row])); const pages = Math.max(1, Math.ceil(count / pageSize));
  return <section className={styles.panel}><header className={styles.panelHeader}><div><p className={styles.kicker}>Historia</p><h3>Wyszukaj i popraw dowolny wpis</h3></div><a className={styles.secondary} href={`/api/company/hr/export?workspaceId=${encodeURIComponent(workspaceId)}&mode=timesheet&period=month&referenceDate=${encodeURIComponent(to)}`}><Download size={14} /> Eksport</a></header><div className={styles.historyFilters}><label>Od<input type="date" value={from} onChange={(event) => onFrom(event.target.value)} /></label><label>Do<input type="date" value={to} onChange={(event) => onTo(event.target.value)} /></label><label>Pracownik<select value={employeeId} onChange={(event) => onEmployee(event.target.value)}><option value="">Wszyscy</option>{employees.map((employee) => <option value={String(employee.id)} key={String(employee.id)}>{employeeName(employee)}</option>)}</select></label><label>Inwestycja<select value={projectId} onChange={(event) => onProject(event.target.value)}><option value="">Wszystkie</option><option value="__none__">Bez inwestycji</option>{projects.map((project) => <option value={String(project.id)} key={String(project.id)}>{str(project.name)}</option>)}</select></label><label>Status<select value={status} onChange={(event) => onStatus(event.target.value)}>{statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><button type="button" className={styles.resetFilters} onClick={onReset}><RotateCcw size={14} /> Reset</button></div><div className={styles.historyMeta}><span><Filter size={14} /> {count} pasujących wpisów</span>{loading ? <span><LoaderCircle size={14} className={styles.spin} /> Pobieranie…</span> : null}</div><div className={styles.historyWrap}><table className={styles.historyTable}><thead><tr><th>Data</th><th>Pracownik</th><th>Inwestycja</th><th>Godziny</th><th>Nadg.</th><th>Status</th>{canViewPayroll ? <th>Koszt</th> : null}<th /></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td><strong>{compactDate(String(row.work_date).slice(0, 10))}</strong><small>{dateLabel(String(row.work_date).slice(0, 10), { weekday: "short" })}</small></td><td>{employeeName(employeeById.get(String(row.employee_id)))}</td><td>{row.project_id ? str(projectById.get(String(row.project_id))?.name, "Inwestycja") : "Koszt ogólny"}{row.work_scope ? <small>{str(row.work_scope)}</small> : null}</td><td>{num(row.hours)} h</td><td>{num(row.overtime_hours)} h</td><td><span className={`${styles.status} ${statusClass(row.status)}`}>{statusLabel(row.status)}</span></td>{canViewPayroll ? <td>{row.labor_cost_snapshot == null ? "—" : money(row.labor_cost_snapshot)}</td> : null}<td><button type="button" className={styles.editButton} onClick={() => onEdit(row)}><Pencil size={14} /> Edytuj</button></td></tr>)}{!rows.length && !loading ? <tr><td colSpan={canViewPayroll ? 8 : 7}><div className={styles.empty}>Brak wpisów dla wybranych filtrów.</div></td></tr> : null}</tbody></table></div><div className={styles.pagination}><button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}><ChevronLeft size={15} /> Poprzednia</button><span>Strona {page + 1} z {pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Następna <ChevronRight size={15} /></button></div></section>;
}
