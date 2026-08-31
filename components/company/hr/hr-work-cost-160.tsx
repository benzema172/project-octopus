"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Pencil, RefreshCw, Save, X } from "lucide-react";
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

export function HrWorkCost160({ workspaceId, referenceDate, employees, projects, canWrite, canViewPayroll, fixedEmployeeId = null, fixedWorkDate = null, embedded = false, initialProjectId = null }: Props) {
  const router = useRouter();
  const autoAttachedRef = useRef(false);
  const [data, setData] = useState<LaborResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Row | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? "");

  useEffect(() => {
    autoAttachedRef.current = false;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setEditing(null);
      setSelectedProjectId(initialProjectId ?? "");
    });
    return () => { cancelled = true; };
  }, [fixedEmployeeId, fixedWorkDate, initialProjectId]);

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
  const availableWbs = useMemo(() => (data?.wbsNodes ?? []).filter((row) => selectedProjectId && String(row.project_id) === selectedProjectId), [data?.wbsNodes, selectedProjectId]);
  const activeEmployees = useMemo(() => employees.filter((row) => row.status === "active"), [employees]);
  const fixedEmployee = fixedEmployeeId ? employeeById.get(fixedEmployeeId) : undefined;
  const rows = useMemo(() => (data?.rows ?? []).filter((row) => {
    if (fixedEmployeeId && String(row.employee_id) !== fixedEmployeeId) return false;
    if (fixedWorkDate && String(row.work_date ?? "").slice(0, 10) !== fixedWorkDate) return false;
    return true;
  }), [data?.rows, fixedEmployeeId, fixedWorkDate]);

  useEffect(() => {
    if (!embedded || !fixedEmployeeId || !fixedWorkDate || !data || autoAttachedRef.current) return;
    autoAttachedRef.current = true;
    if (rows.length !== 1) return;
    const row = rows[0];
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setEditing(row);
      setSelectedProjectId(row.project_id ? String(row.project_id) : initialProjectId ?? "");
    });
    return () => { cancelled = true; };
  }, [data, embedded, fixedEmployeeId, fixedWorkDate, initialProjectId, rows]);

  const resetForm = () => {
    setEditing(null);
    setSelectedProjectId(initialProjectId ?? "");
    setMessage(null);
  };

  const beginEdit = (row: Row) => {
    setEditing(row);
    setSelectedProjectId(row.project_id ? String(row.project_id) : "");
    setMessage(null);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || busy) return;
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
    const action = editing?.id ? "update" : "create";
    if (editing?.id) payload.timesheetId = editing.id;
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
      const result = await response.json().catch(() => ({})) as { error?: string; calculatedHours?: number | null; laborCostSnapshot?: number | null };
      if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać czasu pracy.");
      const calculated = result.calculatedHours != null ? ` Wyliczono ${num(result.calculatedHours, 2)} h z godzin od–do.` : "";
      const cost = canViewPayroll && result.laborCostSnapshot != null ? ` Zamrożony koszt wpisu: ${money(result.laborCostSnapshot)}.` : "";
      setMessage(`${action === "create" ? "Wpis dodano." : "Wpis zaktualizowano."}${calculated}${cost}`);
      setEditing(null);
      setSelectedProjectId(initialProjectId ?? "");
      setReloadKey((value) => value + 1);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać czasu pracy.");
    } finally {
      setBusy(false);
    }
  };

  const summary = data?.summary;
  const periodLabel = data?.period ? new Date(`${data.period}-01T00:00:00Z`).toLocaleDateString("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" }) : referenceDate.slice(0, 7);
  const editKey = editing?.id ? String(editing.id) : `new-${fixedEmployeeId ?? "all"}-${fixedWorkDate ?? referenceDate}-${reloadKey}`;
  const fixedDate = fixedWorkDate ?? referenceDate;

  return <section className={`${styles.panel} ${embedded ? styles.embedded : ""}`} data-hr-work-cost-control="1" data-hr-work-cost-embedded={embedded ? "1" : undefined}>
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
    </> : <div className={styles.embeddedContext}>
      <div>
        <span>Ewidencja szczegółowa</span>
        <strong>{employeeName(fixedEmployee)} · {dateLabel(fixedDate)}</strong>
      </div>
      <small>Rozszerza wpis z wiersza powyżej o WBS, zakres prac, godziny od–do, ilość i kod kosztowy.</small>
    </div>}

    <div className={styles.body}>
      <form className={styles.formCard} key={editKey} onSubmit={submit}>
        <div className={styles.formTitle}>
          <h3>{editing ? `${embedded ? "Rozszerz wpis" : "Edytuj wpis"} · ${dateLabel(editing.work_date)}` : embedded ? "Dodaj drugi szczegółowy wpis" : "Dodaj szczegółowy wpis z budowy"}</h3>
          <span>{editing ? "Zmieniasz ten sam wpis czasu — nie tworzymy duplikatu. Koszt zostanie ponownie wyliczony według stawki z dnia pracy." : "Godziny możesz wpisać ręcznie albo zostawić puste i podać od–do."}</span>
        </div>
        <div className={styles.grid}>
          {fixedEmployeeId ? <>
            <input type="hidden" name="employeeId" value={fixedEmployeeId} />
            <label className={styles.field}><span>Pracownik</span><input value={employeeName(fixedEmployee)} readOnly disabled /></label>
          </> : <label className={styles.field}><span>Pracownik</span><select name="employeeId" defaultValue={editing ? String(editing.employee_id ?? "") : ""} required disabled={!canWrite || busy || Boolean(editing)}><option value="">Wybierz</option>{activeEmployees.map((employee) => <option key={String(employee.id)} value={String(employee.id)}>{employeeName(employee)}</option>)}</select></label>}
          {fixedWorkDate ? <>
            <input type="hidden" name="workDate" value={fixedWorkDate} />
            <label className={styles.field}><span>Data</span><input value={fixedWorkDate} readOnly disabled /></label>
          </> : <label className={styles.field}><span>Data</span><input name="workDate" type="date" defaultValue={editing ? String(editing.work_date ?? "").slice(0, 10) : referenceDate} required disabled={!canWrite || busy || Boolean(editing)} /></label>}
          <label className={styles.fieldWide}><span>Inwestycja</span><select name="projectId" value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} disabled={!canWrite || busy}><option value="">Koszt ogólny firmy / bez inwestycji</option>{projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{str(project.name, "Inwestycja")}</option>)}</select></label>
          <label className={styles.fieldWide}><span>WBS / zakres kosztorysowy</span><select name="wbsNodeId" defaultValue={editing?.wbs_node_id ? String(editing.wbs_node_id) : ""} disabled={!canWrite || busy || !selectedProjectId}><option value="">Bez WBS</option>{availableWbs.map((node) => <option key={String(node.id)} value={String(node.id)}>{str(node.code, "WBS")} · {str(node.name)}</option>)}</select></label>
          <label className={styles.field}><span>Rodzaj czasu</span><select name="workType" defaultValue={str(editing?.work_type, "regular")} disabled={!canWrite || busy}>{WORK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className={styles.field}><span>Kod kosztowy</span><input name="costCode" defaultValue={str(editing?.cost_code, "")} placeholder="np. ROB-WENT-01" disabled={!canWrite || busy} /></label>
          <label className={styles.fieldWide}><span>Zakres wykonanych prac</span><input name="workScope" defaultValue={str(editing?.work_scope, "")} placeholder="np. montaż kanałów wentylacyjnych — budynek A" disabled={!canWrite || busy} /></label>
          <label className={styles.fieldSmall}><span>Od</span><input name="startedAt" type="time" defaultValue={str(editing?.started_at, "").slice(0, 5)} disabled={!canWrite || busy} /></label>
          <label className={styles.fieldSmall}><span>Do</span><input name="endedAt" type="time" defaultValue={str(editing?.ended_at, "").slice(0, 5)} disabled={!canWrite || busy} /></label>
          <label className={styles.fieldSmall}><span>Przerwa min</span><input name="breakMinutes" inputMode="numeric" defaultValue={str(editing?.break_minutes, "0")} disabled={!canWrite || busy} /></label>
          <label className={styles.fieldSmall}><span>Godziny</span><input name="hours" inputMode="decimal" defaultValue={editing ? str(editing.hours, "") : "8"} placeholder="auto z od–do" disabled={!canWrite || busy} /></label>
          <label className={styles.fieldSmall}><span>Nadgodziny</span><input name="overtimeHours" inputMode="decimal" defaultValue={editing ? str(editing.overtime_hours, "0") : "0"} disabled={!canWrite || busy} /></label>
          <label className={styles.fieldSmall}><span>Ilość</span><input name="quantity" inputMode="decimal" defaultValue={str(editing?.quantity, "")} placeholder="np. 32" disabled={!canWrite || busy} /></label>
          <label className={styles.fieldSmall}><span>Jednostka</span><input name="unit" defaultValue={str(editing?.unit, "")} placeholder="mb / szt. / m²" disabled={!canWrite || busy} /></label>
          <label className={`${styles.field} ${styles.fieldFull}`}><span>Uwagi</span><textarea name="note" defaultValue={str(editing?.note, "")} placeholder="Przeszkody, przestój, front robót, dodatkowa informacja dla kierownika" disabled={!canWrite || busy} /></label>
          <div className={`${styles.note} ${styles.fieldFull}`}><Clock3 size={13} /> WBS pochodzi bezpośrednio z inwestycji. Snapshot kosztu wykorzystuje stawkę obowiązującą w dacie pracy; nadgodziny są liczone godzinowo bez automatycznego mnożnika płacowego.</div>
          <div className={styles.actions}>
            {editing ? <button className={styles.secondary} type="button" onClick={resetForm} disabled={busy}><X size={14} /> {embedded ? "Nowy wpis" : "Anuluj edycję"}</button> : null}
            <button className={styles.primary} type="submit" disabled={!canWrite || busy}><Save size={14} /> {busy ? "Zapisywanie…" : editing ? "Zapisz szczegóły" : "Dodaj wpis"}</button>
          </div>
        </div>
      </form>

      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Data / pracownik</th><th>Inwestycja</th><th>WBS / kod</th><th>Rodzaj</th><th>Zakres / ilość</th><th>Godziny</th><th>Status</th>{data?.canViewCosts ? <th>Koszt</th> : null}<th /></tr></thead>
          <tbody>{rows.slice(0, 120).map((row) => {
            const employee = employeeById.get(String(row.employee_id));
            const project = row.project_id ? projectById.get(String(row.project_id)) : null;
            const wbs = row.wbs_node_id ? wbsById.get(String(row.wbs_node_id)) : null;
            const workType = WORK_TYPES.find(([value]) => value === str(row.work_type, "regular"))?.[1] ?? str(row.work_type);
            const totalHours = Number(row.hours ?? 0) + Number(row.overtime_hours ?? 0);
            return <tr key={String(row.id)}>
              <td><div className={styles.mainCell}><strong>{dateLabel(row.work_date)} · {employeeName(employee)}</strong><span>{row.started_at ? `${str(row.started_at).slice(0, 5)}–${str(row.ended_at).slice(0, 5)} · przerwa ${str(row.break_minutes, "0")} min` : str(row.source, "ręcznie")}</span></div></td>
              <td>{project ? str(project.name) : <span className={styles.chip}>Koszt ogólny</span>}</td>
              <td><div className={styles.mainCell}><strong>{wbs ? `${str(wbs.code, "WBS")} · ${str(wbs.name)}` : "—"}</strong><span>{str(row.cost_code, "bez kodu kosztowego")}</span></div></td>
              <td><span className={styles.chip}>{workType}</span></td>
              <td className={styles.scope}><div className={styles.mainCell}><strong>{str(row.work_scope)}</strong><span>{row.quantity != null ? `${num(row.quantity, 3)} ${str(row.unit, "j.")}` : "bez ilości wykonanej"}</span></div></td>
              <td><strong>{num(totalHours, 2)} h</strong>{Number(row.overtime_hours ?? 0) > 0 ? <div className={`${styles.chip} ${styles.warn}`}>+{num(row.overtime_hours)} nadg.</div> : null}</td>
              <td><span className={`${styles.chip} ${row.status === "approved" ? styles.ok : ""}`}>{str(row.status)}</span></td>
              {data?.canViewCosts ? <td><span className={styles.cost}>{row.labor_cost_snapshot == null ? "brak stawki" : money(row.labor_cost_snapshot)}</span><div className={styles.mainCell}><span>{row.hourly_cost_snapshot == null ? "" : `${money(row.hourly_cost_snapshot)}/h`}</span></div></td> : null}
              <td>{canWrite ? <button type="button" className={styles.edit} onClick={() => beginEdit(row)} disabled={busy}><Pencil size={13} /> Edytuj</button> : null}</td>
            </tr>;
          })}</tbody>
        </table>
        {!rows.length && !error ? <div className={styles.empty}>{embedded ? "Brak wpisu szczegółowego dla tego pracownika i dnia. Formularz powyżej utworzy pierwszy." : "Brak szczegółowych wpisów czasu w tym miesiącu. Dodaj pierwszy wpis powyżej."}</div> : null}
      </div>
    </div>
  </section>;
}