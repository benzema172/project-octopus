"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Pencil, Plus, RefreshCw, Save, X } from "lucide-react";
import styles from "./hr-work-cost-160.module.css";

type Row = Record<string, unknown>;
type LaborResponse = {
  ok: boolean;
  period: string;
  canViewCosts: boolean;
  rows: Row[];
  wbsNodes: Row[];
  summary: {
    totalHours: number;
    approvedHours: number;
    overtimeHours: number;
    travelHours: number;
    downtimeHours: number;
    approvedCost: number | null;
    missingWbs: number;
    missingCostSnapshot: number | null;
  };
};

type Props = {
  workspaceId: string;
  referenceDate: string;
  employees: Row[];
  projects: Row[];
  canWrite: boolean;
  canViewPayroll: boolean;
  fixedEmployeeId?: string | null;
  fixedWorkDate?: string | null;
  embedded?: boolean;
  initialProjectId?: string | null;
  leave?: Row | null;
  dayStatus?: "sick" | null;
  enableDayStatusSelection?: boolean;
  onDayStatusChanged?: (status: "sick" | null) => void;
  onChanged?: () => void;
};

const WORK_TYPES: Array<[string, string]> = [
  ["regular", "Praca podstawowa"],
  ["travel", "Dojazd / przejazd"],
  ["downtime", "Przestój"],
  ["training", "Szkolenie"],
  ["office", "Praca biurowa"],
  ["night", "Praca nocna"],
  ["other", "Inny czas"]
];

const VACATION_TYPES = new Set(["annual", "on_demand", "unpaid"]);
const VACATION_OPTION = "__vacation__";
const SICK_OPTION = "__sick__";
const ABSENCE_OPTION = "__absence__";
const LEAVE_LABELS: Record<string, string> = {
  annual: "Urlop wypoczynkowy",
  on_demand: "Urlop na żądanie",
  unpaid: "Urlop bezpłatny",
  sick: "Zwolnienie chorobowe",
  maternity: "Urlop macierzyński",
  parental: "Urlop rodzicielski",
  care: "Opieka",
  other: "Nieobecność"
};

function str(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}
function num(value: unknown, digits = 1) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0);
}
function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(Number.isFinite(parsed) ? parsed : 0);
}
function employeeName(row?: Row) {
  if (!row) return "Pracownik";
  return `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number, "Pracownik");
}
function dateLabel(value: unknown) {
  const raw = String(value ?? "").slice(0, 10);
  if (!raw) return "—";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return parsed.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
function totalHours(row?: Row | null) {
  if (!row) return 0;
  return Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0);
}
function isVacationLeave(leave?: Row | null) {
  return Boolean(leave && String(leave.status ?? "approved") === "approved" && VACATION_TYPES.has(String(leave.leave_type ?? "")));
}
function leaveLabel(leave?: Row | null) {
  if (!leave) return "Nieobecność";
  return LEAVE_LABELS[String(leave.leave_type ?? "other")] ?? "Nieobecność";
}
function isSpecialAssignment(value: string) {
  return value === VACATION_OPTION || value === SICK_OPTION || value === ABSENCE_OPTION;
}

export function HrWorkCost160({ workspaceId, referenceDate, employees, projects, canWrite, canViewPayroll, fixedEmployeeId = null, fixedWorkDate = null, embedded = false, initialProjectId = null, leave = null, dayStatus = null, enableDayStatusSelection, onDayStatusChanged, onChanged }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const contextRef = useRef(`${fixedEmployeeId ?? ""}|${fixedWorkDate ?? ""}`);
  const persistedVacation = isVacationLeave(leave);
  const persistedSick = dayStatus === "sick";
  const blockedAbsence = Boolean(leave && String(leave.status ?? "") === "approved" && !persistedVacation);
  const dayStatusEnabled = enableDayStatusSelection ?? Boolean(fixedEmployeeId && fixedWorkDate);
  const initialAssignment = blockedAbsence ? ABSENCE_OPTION : persistedSick ? SICK_OPTION : persistedVacation ? VACATION_OPTION : initialProjectId ?? "";
  const [data, setData] = useState<LaborResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Row | null>(null);
  const [explicitNew, setExplicitNew] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(initialAssignment);
  const [vacationActive, setVacationActive] = useState(persistedVacation);
  const [sickActive, setSickActive] = useState(persistedSick);

  useEffect(() => {
    const nextContext = `${fixedEmployeeId ?? ""}|${fixedWorkDate ?? ""}`;
    const nextVacation = isVacationLeave(leave);
    const nextSick = dayStatus === "sick";
    const nextBlockedAbsence = Boolean(leave && String(leave.status ?? "") === "approved" && !nextVacation);
    const nextAssignment = nextBlockedAbsence ? ABSENCE_OPTION : nextSick ? SICK_OPTION : nextVacation ? VACATION_OPTION : initialProjectId ?? "";
    const contextChanged = contextRef.current !== nextContext;
    contextRef.current = nextContext;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (contextChanged) {
        setEditing(null);
        setExplicitNew(false);
        setMessage(null);
        setError(null);
      }
      setVacationActive(nextVacation);
      setSickActive(nextSick);
      setSelectedProjectId(nextAssignment);
    });
    return () => { cancelled = true; };
  }, [fixedEmployeeId, fixedWorkDate, initialProjectId, leave?.id, leave?.leave_type, leave?.status, dayStatus]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ workspaceId, referenceDate });
    fetch(`/api/company/hr/labor-control?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as LaborResponse & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Nie udało się pobrać kontroli robocizny.");
        return result;
      })
      .then((result) => { setData(result); setError(null); })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Nie udało się pobrać kontroli robocizny.");
      });
    return () => controller.abort();
  }, [workspaceId, referenceDate, reloadKey]);

  const employeeById = useMemo(() => new Map(employees.map((row) => [String(row.id), row])), [employees]);
  const projectById = useMemo(() => new Map(projects.map((row) => [String(row.id), row])), [projects]);
  const wbsById = useMemo(() => new Map((data?.wbsNodes ?? []).map((row) => [String(row.id), row])), [data?.wbsNodes]);
  const realProjectId = isSpecialAssignment(selectedProjectId) ? "" : selectedProjectId;
  const availableWbs = useMemo(() => (data?.wbsNodes ?? []).filter((row) => realProjectId && String(row.project_id) === realProjectId), [data?.wbsNodes, realProjectId]);
  const activeEmployees = useMemo(() => employees.filter((row) => row.status === "active"), [employees]);
  const fixedEmployee = fixedEmployeeId ? employeeById.get(fixedEmployeeId) : undefined;
  const rows = useMemo(() => (data?.rows ?? []).filter((row) => {
    if (fixedEmployeeId && String(row.employee_id) !== fixedEmployeeId) return false;
    if (fixedWorkDate && String(row.work_date ?? "").slice(0, 10) !== fixedWorkDate) return false;
    return true;
  }), [data?.rows, fixedEmployeeId, fixedWorkDate]);
  const formEditing = editing ?? (!explicitNew && embedded && rows.length === 1 ? rows[0] : null);
  const statusMode = sickActive ? "sick" : vacationActive ? "vacation" : blockedAbsence ? "absence" : null;
  const workFieldsDisabled = !canWrite || busy || Boolean(statusMode);

  const focusFormField = (fieldName: string, block: ScrollLogicalPosition = "center") => {
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block });
      formRef.current?.querySelector<HTMLElement>(`[name="${fieldName}"]`)?.focus({ preventScroll: true });
    });
  };

  const startNewRange = () => {
    if (statusMode) return;
    const projectId = formEditing?.project_id ? String(formEditing.project_id) : initialProjectId ?? "";
    setEditing(null);
    setExplicitNew(true);
    setSelectedProjectId(projectId);
    setMessage(null);
    setError(null);
    focusFormField("workScope");
  };

  const cancelNewRange = () => {
    setExplicitNew(false);
    setMessage(null);
    setError(null);
    if (rows.length === 1) {
      const row = rows[0];
      setEditing(row);
      setSelectedProjectId(row.project_id ? String(row.project_id) : "");
    } else {
      setEditing(null);
      setSelectedProjectId(initialProjectId ?? "");
    }
    focusFormField("projectId");
  };

  const beginEdit = (row: Row) => {
    if (statusMode) return;
    setEditing(row);
    setExplicitNew(false);
    setSelectedProjectId(row.project_id ? String(row.project_id) : "");
    setMessage(null);
    setError(null);
    focusFormField("projectId", "start");
  };

  const currentDayIdentity = () => {
    const form = formRef.current;
    const employeeField = form?.elements.namedItem("employeeId");
    const dateField = form?.elements.namedItem("workDate");
    const employeeId = fixedEmployeeId ?? (employeeField instanceof HTMLSelectElement || employeeField instanceof HTMLInputElement ? employeeField.value : "");
    const workDate = fixedWorkDate ?? (dateField instanceof HTMLInputElement ? dateField.value : referenceDate);
    if (!employeeId || !workDate) throw new Error("Najpierw wybierz pracownika i datę.");
    return { employeeId, workDate };
  };

  const postDayStatus = async (path: string, payload: Record<string, unknown>) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, ...payload })
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Nie udało się zmienić statusu dnia.");
  };

  const setVacation = async (employeeId: string, workDate: string, active: boolean) => {
    await postDayStatus("/api/company/hr/calendar-leave", { employeeId, workDate, action: active ? "set" : "clear" });
    setVacationActive(active);
  };

  const setSick = async (employeeId: string, workDate: string, active: boolean) => {
    await postDayStatus("/api/company/hr/day-status", { employeeId, workDate, action: active ? "set_sick" : "clear_sick" });
    setSickActive(active);
    onDayStatusChanged?.(active ? "sick" : null);
  };

  const changeAssignment = async (nextValue: string) => {
    if (!canWrite || busy || blockedAbsence) return;
    if (!dayStatusEnabled || !isSpecialAssignment(nextValue) && !vacationActive && !sickActive) {
      setSelectedProjectId(nextValue);
      return;
    }
    if (nextValue === ABSENCE_OPTION) return;

    let identity: { employeeId: string; workDate: string };
    try {
      identity = currentDayIdentity();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się ustalić dnia pracownika.");
      return;
    }

    const previousSelection = sickActive ? SICK_OPTION : vacationActive ? VACATION_OPTION : selectedProjectId;
    if ((nextValue === VACATION_OPTION || nextValue === SICK_OPTION) && rows.length > 0) {
      const label = nextValue === VACATION_OPTION ? "Urlop" : "Chorobowe";
      if (!window.confirm(`Ten dzień ma już ${rows.length === 1 ? "wpis" : "wpisy"} czasu pracy. ${label} zostanie zapisane, a system pokaże konflikt danych do wyjaśnienia. Kontynuować?`)) {
        setSelectedProjectId(previousSelection);
        return;
      }
    }

    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      if (nextValue === VACATION_OPTION) {
        if (!vacationActive) {
          if (sickActive) await setSick(identity.employeeId, identity.workDate, false);
          try {
            await setVacation(identity.employeeId, identity.workDate, true);
          } catch (reason) {
            if (sickActive) await setSick(identity.employeeId, identity.workDate, true).catch(() => undefined);
            throw reason;
          }
        }
        setSickActive(false);
        onDayStatusChanged?.(null);
        setSelectedProjectId(VACATION_OPTION);
        setMessage("Urlop zapisany. Wniosek urlopowy jest zsynchronizowany z kalendarzem, Czasem pracy i Listą obecności.");
      } else if (nextValue === SICK_OPTION) {
        if (!sickActive) {
          if (vacationActive) await setVacation(identity.employeeId, identity.workDate, false);
          try {
            await setSick(identity.employeeId, identity.workDate, true);
          } catch (reason) {
            if (vacationActive) await setVacation(identity.employeeId, identity.workDate, true).catch(() => undefined);
            throw reason;
          }
        }
        setVacationActive(false);
        setSelectedProjectId(SICK_OPTION);
        setMessage("Chorobowe zapisane jako niezależny znacznik dnia. Nie utworzono wniosku urlopowego i nie zmieniono puli urlopu.");
      } else {
        if (vacationActive) await setVacation(identity.employeeId, identity.workDate, false);
        if (sickActive) await setSick(identity.employeeId, identity.workDate, false);
        setVacationActive(false);
        setSickActive(false);
        onDayStatusChanged?.(null);
        setSelectedProjectId(nextValue);
        setMessage("Status nieobecności usunięty. Możesz uzupełnić i zapisać pracę dla tego dnia.");
      }
      setReloadKey((value) => value + 1);
      router.refresh();
      onChanged?.();
    } catch (reason) {
      setSelectedProjectId(previousSelection);
      setError(reason instanceof Error ? reason.message : "Nie udało się zmienić statusu dnia.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || busy || statusMode) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload: Record<string, unknown> = {
      projectId: values.projectId,
      wbsNodeId: values.wbsNodeId,
      workType: values.workType,
      costCode: values.costCode,
      workScope: values.workScope,
      startedAt: values.startedAt,
      endedAt: values.endedAt,
      breakMinutes: values.breakMinutes,
      hours: values.hours,
      overtimeHours: values.overtimeHours,
      quantity: values.quantity,
      unit: values.unit,
      note: values.note
    };
    const action = formEditing?.id ? "update" : "create";
    if (formEditing?.id) payload.timesheetId = formEditing.id;
    else {
      payload.employeeId = values.employeeId;
      payload.workDate = values.workDate;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/company/hr/timesheet-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action, payload })
      });
      const result = await response.json().catch(() => ({})) as { id?: string; error?: string; calculatedHours?: number | null; laborCostSnapshot?: number | null };
      if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać czasu pracy.");
      const calculated = result.calculatedHours != null ? ` Wyliczono ${num(result.calculatedHours, 2)} h z godzin od–do.` : "";
      const cost = canViewPayroll && result.laborCostSnapshot != null ? ` Zamrożony koszt wpisu: ${money(result.laborCostSnapshot)}.` : "";
      setMessage(`${action === "create" ? "Wpis dodano." : "Wpis zaktualizowano."}${calculated}${cost}`);
      if (action === "create") {
        setEditing(null);
        setExplicitNew(true);
        setSelectedProjectId(initialProjectId ?? "");
      }
      setReloadKey((value) => value + 1);
      router.refresh();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać czasu pracy.");
    } finally {
      setBusy(false);
    }
  };

  const summary = data?.summary;
  const periodLabel = data?.period ? new Date(`${data.period}-01T00:00:00Z`).toLocaleDateString("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" }) : referenceDate.slice(0, 7);
  const editKey = formEditing?.id ? String(formEditing.id) : `new-${fixedEmployeeId ?? "all"}-${fixedWorkDate ?? referenceDate}-${reloadKey}`;
  const fixedDate = fixedWorkDate ?? referenceDate;
  const contextRow = formEditing ?? (rows.length === 1 ? rows[0] : null);
  const contextProject = realProjectId ? projectById.get(realProjectId) : contextRow?.project_id ? projectById.get(String(contextRow.project_id)) : null;
  const contextStatus = contextRow ? str(contextRow.status, "") : "";
  const contextHours = rows.reduce((sum, row) => sum + totalHours(row), 0);
  const contextModeLabel = sickActive ? "Chorobowe" : vacationActive ? "Urlop" : blockedAbsence ? leaveLabel(leave) : contextProject ? str(contextProject.name) : "Koszt ogólny";
  const statusConflict = Boolean(statusMode && contextHours > 0);

  return <section className={`${styles.panel} ${embedded ? styles.embedded : ""}`} data-hr-work-cost-control="1" data-hr-work-cost-embedded={embedded ? "1" : undefined} data-hr-day-status-synced={dayStatusEnabled ? "1" : undefined}>
    {!embedded ? <>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Budowa · godziny · koszt</p>
          <h2>Kontrola robocizny i zakresów prac</h2>
          <p>Czas można przypisać do inwestycji i jej WBS, rodzaju pracy oraz kodu kosztowego. Koszt godziny jest zamrażany na dzień wpisu, więc późniejsza podwyżka nie zmieni historii inwestycji.</p>
        </div>
        <button className={styles.refresh} type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={busy}><RefreshCw size={14} /> Odśwież</button>
      </header>

      <div className={styles.metrics}>
        <div className={styles.metric}><small>Godziny · {periodLabel}</small><strong>{num(summary?.totalHours)} h</strong><span>{num(summary?.approvedHours)} h zatwierdzone</span></div>
        <div className={styles.metric}><small>Nadgodziny</small><strong>{num(summary?.overtimeHours)} h</strong><span>Dojazdy: {num(summary?.travelHours)} h</span></div>
        <div className={styles.metric}><small>Przestoje</small><strong>{num(summary?.downtimeHours)} h</strong><span>osobno od pracy produkcyjnej</span></div>
        <div className={styles.metric}><small>Brak WBS</small><strong>{num(summary?.missingWbs, 0)}</strong><span>wpisów na inwestycjach do opisania</span></div>
        <div className={styles.metric}><small>Koszt zatwierdzony</small><strong>{data?.canViewCosts && summary?.approvedCost != null ? money(summary.approvedCost) : "Ukryty"}</strong><span>{data?.canViewCosts ? `${num(summary?.missingCostSnapshot, 0)} wpisów bez stawki` : "wymaga dostępu do kosztów"}</span></div>
      </div>
    </> : <div className={`${styles.embeddedContext} ${statusMode ? styles.embeddedContextStatus : ""}`}>
      <div>
        <span>{statusMode ? "Status dnia" : "Szczegóły robocizny"}</span>
        <strong>{dateLabel(fixedDate)} · {contextModeLabel}{statusConflict ? ` · konflikt: ${num(contextHours, 2)} h pracy` : !statusMode && contextRow ? ` · ${num(totalHours(contextRow), 2)} h` : ""}</strong>
      </div>
      {contextRow && !statusMode ? <div className={styles.embeddedMeta}>
        {data?.canViewCosts && contextRow.labor_cost_snapshot != null ? <b>{money(contextRow.labor_cost_snapshot)}</b> : null}
        {contextStatus ? <span className={`${styles.chip} ${contextStatus === "approved" ? styles.ok : ""}`}>{contextStatus}</span> : null}
      </div> : statusMode ? <span className={`${styles.dayStatusChip} ${sickActive ? styles.dayStatusSick : vacationActive ? styles.dayStatusVacation : styles.dayStatusAbsence}`}>{contextModeLabel}</span> : <small>Uzupełnij zakres pracy bez tworzenia osobnego modułu.</small>}
    </div>}

    <div className={styles.body}>
      {!data && !error ? <div className={styles.empty} role="status">Wczytywanie szczegółów robocizny…</div> : <>
      {explicitNew && embedded && !statusMode ? <div className={styles.success} role="status" data-hr-new-range-state="1"><strong>Nowy zakres robocizny.</strong> Istniejący wpis pozostaje bez zmian. Uzupełnij poniżej drugi zakres i zapisz go przyciskiem „Dodaj nowy zakres”.</div> : null}
      <form ref={formRef} className={styles.formCard} key={editKey} onSubmit={submit} data-hr-labor-edit-form="1" data-hr-new-range={explicitNew && embedded ? "1" : undefined}>
        <div className={styles.formTitle}>
          <h3>{statusMode ? "Status dnia" : formEditing ? (embedded ? "Edytuj szczegóły wpisu" : `Edytuj wpis · ${dateLabel(formEditing.work_date)}`) : embedded ? "Nowy zakres robocizny" : "Dodaj szczegółowy wpis z budowy"}</h3>
          <span>{sickActive ? "CHOROBOWE jest niezależnym znacznikiem ewidencji. Nie tworzy wniosku urlopowego i nie pomniejsza puli urlopu." : vacationActive ? "URLOP jest zsynchronizowany z wnioskiem urlopowym, kalendarzem i listą obecności." : blockedAbsence ? `${leaveLabel(leave)} pochodzi z ewidencji nieobecności. Zmień ją w zakładce Urlopy i absencje.` : formEditing ? "Edytujesz ten sam wpis czasu — bez duplikowania godzin. Koszt zostanie ponownie wyliczony według stawki z dnia pracy." : embedded ? "To będzie osobny wpis tego samego dnia. Istniejących godzin i szczegółów nie zmieniamy." : "Godziny możesz wpisać ręcznie albo zostawić puste i podać od–do."}</span>
        </div>
        <div className={styles.grid}>
          {fixedEmployeeId ? <input type="hidden" name="employeeId" value={fixedEmployeeId} /> : <label className={styles.field}><span>Pracownik</span><select name="employeeId" defaultValue={formEditing ? String(formEditing.employee_id ?? "") : ""} required disabled={!canWrite || busy || Boolean(formEditing)}><option value="">Wybierz</option>{activeEmployees.map((employee) => <option key={String(employee.id)} value={String(employee.id)}>{employeeName(employee)}</option>)}</select></label>}
          {fixedWorkDate ? <input type="hidden" name="workDate" value={fixedWorkDate} /> : <label className={styles.field}><span>Data</span><input name="workDate" type="date" defaultValue={formEditing ? String(formEditing.work_date ?? "").slice(0, 10) : referenceDate} required disabled={!canWrite || busy || Boolean(formEditing)} /></label>}
          <label className={styles.fieldWide}><span>{dayStatusEnabled ? "Inwestycja / status" : "Inwestycja"}</span><select name="projectId" value={selectedProjectId} onChange={(event) => void changeAssignment(event.target.value)} disabled={!canWrite || busy || blockedAbsence}>{dayStatusEnabled ? <><option value={VACATION_OPTION}>URLOP</option><option value={SICK_OPTION}>CHOROBOWE</option>{blockedAbsence ? <option value={ABSENCE_OPTION}>{leaveLabel(leave).toUpperCase()}</option> : null}</> : null}<option value="">Koszt ogólny firmy / bez inwestycji</option>{projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{str(project.name, "Inwestycja")}</option>)}</select></label>
          <label className={styles.fieldWide}><span>WBS / zakres kosztorysowy</span><select name="wbsNodeId" defaultValue={formEditing?.wbs_node_id ? String(formEditing.wbs_node_id) : ""} disabled={workFieldsDisabled || !realProjectId}><option value="">Bez WBS</option>{availableWbs.map((node) => <option key={String(node.id)} value={String(node.id)}>{str(node.code, "WBS")} · {str(node.name)}</option>)}</select></label>
          <label className={styles.field}><span>Rodzaj czasu</span><select name="workType" defaultValue={str(formEditing?.work_type, "regular")} disabled={workFieldsDisabled}>{WORK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className={styles.field}><span>Kod kosztowy</span><input name="costCode" defaultValue={str(formEditing?.cost_code, "")} placeholder="np. ROB-WENT-01" disabled={workFieldsDisabled} /></label>
          <label className={styles.fieldWide}><span>Zakres wykonanych prac</span><input name="workScope" defaultValue={str(formEditing?.work_scope, "")} placeholder="np. montaż kanałów wentylacyjnych — budynek A" disabled={workFieldsDisabled} /></label>
          <label className={styles.fieldSmall}><span>Od</span><input name="startedAt" type="time" defaultValue={str(formEditing?.started_at, "").slice(0, 5)} disabled={workFieldsDisabled} /></label>
          <label className={styles.fieldSmall}><span>Do</span><input name="endedAt" type="time" defaultValue={str(formEditing?.ended_at, "").slice(0, 5)} disabled={workFieldsDisabled} /></label>
          <label className={styles.fieldSmall}><span>Przerwa min</span><input name="breakMinutes" inputMode="numeric" defaultValue={str(formEditing?.break_minutes, "0")} disabled={workFieldsDisabled} /></label>
          <label className={styles.fieldSmall}><span>Godziny</span><input name="hours" inputMode="decimal" defaultValue={formEditing ? str(formEditing.hours, "") : explicitNew && embedded ? "" : "8"} placeholder="wpisz godziny lub podaj od–do" disabled={workFieldsDisabled} /></label>
          <label className={styles.fieldSmall}><span>Nadgodziny</span><input name="overtimeHours" inputMode="decimal" defaultValue={formEditing ? str(formEditing.overtime_hours, "0") : "0"} disabled={workFieldsDisabled} /></label>
          <label className={styles.fieldSmall}><span>Ilość</span><input name="quantity" inputMode="decimal" defaultValue={str(formEditing?.quantity, "")} placeholder="np. 32" disabled={workFieldsDisabled} /></label>
          <label className={styles.fieldSmall}><span>Jednostka</span><input name="unit" defaultValue={str(formEditing?.unit, "")} placeholder="mb / szt. / m²" disabled={workFieldsDisabled} /></label>
          <label className={`${styles.field} ${styles.fieldFull}`}><span>Uwagi</span><textarea name="note" defaultValue={str(formEditing?.note, "")} placeholder="Przeszkody, przestój, front robót, dodatkowa informacja dla kierownika" disabled={workFieldsDisabled} /></label>
          <div className={`${styles.note} ${styles.fieldFull}`}>{sickActive ? <><Clock3 size={13} /> CHOROBOWE pozostaje tylko w ewidencji dnia i na liście obecności — nie jest wnioskiem urlopowym.</> : vacationActive ? <><Clock3 size={13} /> URLOP jest zapisany jako zatwierdzony wniosek urlopowy i wpływa na wykorzystanie puli urlopowej.</> : blockedAbsence ? <><Clock3 size={13} /> {leaveLabel(leave)} blokuje zapis pracy. Zmień źródłową nieobecność przed wpisaniem godzin.</> : <><Clock3 size={13} /> WBS pochodzi bezpośrednio z inwestycji. Snapshot kosztu wykorzystuje stawkę obowiązującą w dacie pracy; nadgodziny są liczone godzinowo bez automatycznego mnożnika płacowego.</>}</div>
          <div className={styles.actions}>
            {!statusMode && formEditing ? <button className={styles.secondary} type="button" onClick={embedded ? startNewRange : () => setEditing(null)} disabled={busy}>{embedded ? <Plus size={14} /> : <X size={14} />} {embedded ? "Dodaj kolejny zakres" : "Anuluj edycję"}</button> : !statusMode && explicitNew && embedded ? <button className={styles.secondary} type="button" onClick={cancelNewRange} disabled={busy}><X size={14} /> Anuluj dodawanie</button> : null}
            <button className={styles.primary} type="submit" disabled={!canWrite || busy || Boolean(statusMode)}><Save size={14} /> {busy ? "Zapisywanie…" : statusMode ? "Status dnia zapisany" : formEditing ? "Zapisz szczegóły" : embedded ? "Dodaj nowy zakres" : "Dodaj wpis"}</button>
          </div>
        </div>
      </form>

      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      {embedded ? rows.length > 1 ? <div className={styles.splitBlock} data-hr-day-split="1">
        <div className={styles.splitHeader}><strong>Podział dnia · {rows.length} wpisy</strong><span>{statusMode ? "Wpisy pracy pozostają widoczne, ponieważ dzień ma konflikt statusu z pracą." : "Lista pojawia się tylko wtedy, gdy dzień faktycznie został rozbity na kilka zakresów."}</span></div>
        <div className={styles.splitList}>{rows.map((row, index) => {
          const project = row.project_id ? projectById.get(String(row.project_id)) : null;
          const wbs = row.wbs_node_id ? wbsById.get(String(row.wbs_node_id)) : null;
          const workType = WORK_TYPES.find(([value]) => value === str(row.work_type, "regular"))?.[1] ?? str(row.work_type);
          return <div className={styles.splitRow} key={String(row.id)}>
            <span className={styles.splitIndex}>{index + 1}</span>
            <div className={styles.splitMain}><strong>{num(totalHours(row), 2)} h · {project ? str(project.name) : "Koszt ogólny"}</strong><span>{wbs ? `${str(wbs.code, "WBS")} · ${str(wbs.name)}` : str(row.work_scope, workType)}</span></div>
            {data?.canViewCosts && row.labor_cost_snapshot != null ? <b className={styles.splitCost}>{money(row.labor_cost_snapshot)}</b> : null}
            {canWrite ? <button type="button" className={styles.edit} onClick={() => beginEdit(row)} disabled={busy || Boolean(statusMode)} aria-label={`Edytuj zakres ${index + 1}`}><Pencil size={13} /> Edytuj</button> : null}
          </div>;
        })}</div>
      </div> : null : <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Data / pracownik</th><th>Inwestycja</th><th>WBS / kod</th><th>Rodzaj</th><th>Zakres / ilość</th><th>Godziny</th><th>Status</th>{data?.canViewCosts ? <th>Koszt</th> : null}<th /></tr></thead>
          <tbody>{rows.slice(0, 120).map((row) => {
            const employee = employeeById.get(String(row.employee_id));
            const project = row.project_id ? projectById.get(String(row.project_id)) : null;
            const wbs = row.wbs_node_id ? wbsById.get(String(row.wbs_node_id)) : null;
            const workType = WORK_TYPES.find(([value]) => value === str(row.work_type, "regular"))?.[1] ?? str(row.work_type);
            const rowTotalHours = totalHours(row);
            return <tr key={String(row.id)}>
              <td><div className={styles.mainCell}><strong>{dateLabel(row.work_date)} · {employeeName(employee)}</strong><span>{row.started_at ? `${str(row.started_at).slice(0, 5)}–${str(row.ended_at).slice(0, 5)} · przerwa ${str(row.break_minutes, "0")} min` : str(row.source, "ręcznie")}</span></div></td>
              <td>{project ? str(project.name) : <span className={styles.chip}>Koszt ogólny</span>}</td>
              <td><div className={styles.mainCell}><strong>{wbs ? `${str(wbs.code, "WBS")} · ${str(wbs.name)}` : "—"}</strong><span>{str(row.cost_code, "bez kodu kosztowego")}</span></div></td>
              <td><span className={styles.chip}>{workType}</span></td>
              <td className={styles.scope}><div className={styles.mainCell}><strong>{str(row.work_scope)}</strong><span>{row.quantity != null ? `${num(row.quantity, 3)} ${str(row.unit, "j.")}` : "bez ilości wykonanej"}</span></div></td>
              <td><strong>{num(rowTotalHours, 2)} h</strong>{Number(row.overtime_hours ?? 0) > 0 ? <div className={`${styles.chip} ${styles.warn}`}>+{num(row.overtime_hours)} nadg.</div> : null}</td>
              <td><span className={`${styles.chip} ${row.status === "approved" ? styles.ok : ""}`}>{str(row.status)}</span></td>
              {data?.canViewCosts ? <td><span className={styles.cost}>{row.labor_cost_snapshot == null ? "brak stawki" : money(row.labor_cost_snapshot)}</span><div className={styles.mainCell}><span>{row.hourly_cost_snapshot == null ? "" : `${money(row.hourly_cost_snapshot)}/h`}</span></div></td> : null}
              <td>{canWrite ? <button type="button" className={styles.edit} onClick={() => beginEdit(row)} disabled={busy}><Pencil size={13} /> Edytuj</button> : null}</td>
            </tr>;
          })}</tbody>
        </table>
        {!rows.length && !error ? <div className={styles.empty}>Brak szczegółowych wpisów czasu w tym miesiącu. Dodaj pierwszy wpis powyżej.</div> : null}
      </div>}
      </>}
    </div>
  </section>;
}
