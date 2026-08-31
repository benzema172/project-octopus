"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Download, Eye, FileText, Printer, Search, X } from "lucide-react";
import { HrLeaves163 } from "./hr-leaves-163";
import styles from "./hr-leaves-stable-164.module.css";

type Row = Record<string, unknown>;
type LeavesData = {
  referenceDate: string;
  year: number;
  employees: Row[];
  employments: Row[];
  leaves: Row[];
  leaveBalances: Row[];
};

type Props = {
  workspaceId: string;
  data: LeavesData;
  canWrite: boolean;
  canApprove: boolean;
};

type ActionResult = { error?: string };

const LEAVE_TYPES: Record<string, string> = {
  annual: "Wypoczynkowy",
  circumstantial: "Okolicznościowy",
  rehabilitation: "Rehabilitacyjny",
  care: "Opiekuńczy",
  training: "Szkoleniowy",
  on_demand: "Na żądanie",
  unpaid: "Bezpłatny",
  sick: "Chorobowy"
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Oczekuje",
  submitted: "Złożony",
  review: "Weryfikacja",
  approved: "Zatwierdzony",
  rejected: "Odrzucony"
};

function str(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function num(value: unknown, digits = 1) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0);
}

function employeeName(row?: Row) {
  if (!row) return "Pracownik";
  return `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number, "Pracownik");
}

function dateLabel(value: unknown) {
  const raw = String(value ?? "").slice(0, 10);
  if (!raw) return "—";
  const parsed = new Date(`${raw}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString("pl-PL");
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").toLowerCase();
}

function activeEmployment(data: LeavesData, employeeId: string) {
  return data.employments
    .filter((row) => String(row.employee_id) === employeeId)
    .filter((row) => String(row.valid_from ?? "0000-01-01") <= data.referenceDate && (!row.valid_to || String(row.valid_to) >= data.referenceDate))
    .sort((a, b) => String(b.valid_from ?? "").localeCompare(String(a.valid_from ?? "")))[0];
}

function statusClass(status: unknown) {
  const value = String(status ?? "pending");
  if (value === "approved") return styles.statusOk;
  if (value === "rejected") return styles.statusBad;
  return styles.statusWarn;
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] ?? char));
}

function requestHtml(leave: Row, employee: Row | undefined, position: string, year: number) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Wniosek o urlop</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}.page{width:210mm;min-height:297mm;padding:24mm 23mm 15mm;display:flex;flex-direction:column}.top{display:grid;grid-template-columns:1fr 1fr;gap:38mm}.field{text-align:center;font-size:10.5pt}.line{min-height:7mm;border-bottom:1.2px dotted #111;padding-bottom:1mm}.field small{display:block;margin-top:1.5mm;font-size:8.5pt}.dept{width:55%;margin-top:9mm}.title{text-align:center;margin:19mm 0 14mm;font-size:16pt;font-weight:700}.request{font-size:10.5pt;line-height:2.05}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:43mm;margin-top:23mm}.sig{text-align:center;font-size:8.5pt}.sig span{display:block;height:8mm;border-bottom:1.2px dotted #111;margin-bottom:1.5mm}.note{margin-top:13mm;font-size:8.5pt}</style></head><body><main class="page"><div class="top"><div><div class="field"><div class="line">${escapeHtml(employeeName(employee))}</div><small>(imię i nazwisko)</small></div><div class="field dept"><div class="line">${escapeHtml(position)}</div><small>(nazwa działu)</small></div></div><div class="field"><div class="line">................, ${escapeHtml(new Date().toLocaleDateString("pl-PL"))}</div><small>(miejscowość i data)</small></div></div><div class="title">Wniosek o urlop</div><p class="request">Niniejszym składam wniosek o udzielenie w dniach od <strong>${escapeHtml(dateLabel(leave.date_from))}</strong> do <strong>${escapeHtml(dateLabel(leave.date_to))}</strong><br/>przysługującego za rok <strong>${escapeHtml(String(leave.date_from ?? "").slice(0,4) || String(year))}</strong> urlopu <strong>${escapeHtml((LEAVE_TYPES[String(leave.leave_type ?? "annual")] ?? "Wypoczynkowy").toLowerCase())}</strong><br/>(ogółem <strong>${escapeHtml(num(leave.days,0))}</strong> dni ........ godzin).</p><div class="signatures"><div class="sig"><span></span>(podpis kierownika)</div><div class="sig"><span></span>(podpis pracownika)</div></div><div class="note">*) niepotrzebne skreślić</div></main></body></html>`;
}

function printRequest(leave: Row, employee: Row | undefined, position: string, year: number) {
  const popup = window.open("", "_blank", "width=940,height=1000");
  if (!popup) return;
  popup.opener = null;
  popup.document.write(requestHtml(leave, employee, position, year).replace("</body>", "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));<\/script></body>"));
  popup.document.close();
}

function downloadRequest(leave: Row, employee: Row | undefined, position: string, year: number) {
  const popup = window.open("", "_blank", "width=940,height=1000");
  if (!popup) return;
  popup.opener = null;
  popup.document.write(requestHtml(leave, employee, position, year).replace("</body>", "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));<\/script></body>"));
  popup.document.close();
}

export function HrLeavesStable164(props: Props) {
  const { workspaceId, data, canWrite, canApprove } = props;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [previewLeave, setPreviewLeave] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const balanceByEmployee = useMemo(() => new Map(data.leaveBalances.map((row) => [String(row.employee_id), row])), [data.leaveBalances]);
  const employmentByEmployee = useMemo(() => new Map(data.employees.map((employee) => {
    const id = String(employee.id);
    return [id, activeEmployment(data, id)] as const;
  })), [data]);
  const leavesByEmployee = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const leave of data.leaves) {
      if (String(leave.date_from ?? "").slice(0, 4) !== String(data.year)) continue;
      const id = String(leave.employee_id);
      map.set(id, [...(map.get(id) ?? []), leave]);
    }
    for (const rows of map.values()) rows.sort((a, b) => String(b.date_from ?? "").localeCompare(String(a.date_from ?? "")));
    return map;
  }, [data.leaves, data.year]);
  const employees = useMemo(() => data.employees
    .filter((employee) => !query.trim() || normalize(`${employeeName(employee)} ${employee.employee_number ?? ""} ${employmentByEmployee.get(String(employee.id))?.position ?? ""}`).includes(normalize(query)))
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || employeeName(a).localeCompare(employeeName(b), "pl")), [data.employees, employmentByEmployee, query]);

  const decide = async (leaveId: unknown, decision: "approved" | "rejected") => {
    if (!canApprove || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/company/hr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, action: "leave_decision", payload: { leaveId, decision } }) });
      const result = await response.json().catch(() => ({})) as ActionResult;
      if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać decyzji.");
      setMessage(decision === "approved" ? "Wniosek zatwierdzono." : "Wniosek odrzucono.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać decyzji.");
    } finally {
      setBusy(false);
    }
  };

  return <section className={styles.root} data-hr-leaves-stable="1">
    <div className={styles.legacyTop}>
      <HrLeaves163 workspaceId={workspaceId} data={data} canWrite={canWrite} canApprove={canApprove} />
    </div>

    {message ? <div className={styles.feedback}><Check size={15} /> {message}</div> : null}
    {error ? <div className={`${styles.feedback} ${styles.feedbackError}`}><X size={15} /> {error}</div> : null}

    <article className={styles.registry}>
      <header className={styles.registryHeader}>
        <div><span>Urlopy · {data.year}</span><h2>Pracownicy i urlopy</h2><p>Kliknij pracownika, aby rozwinąć kartę bezpośrednio pod jego wierszem.</p></div>
        <label className={styles.search}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj pracownika…" /></label>
      </header>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Pracownik</th><th>Stanowisko</th><th>Limit</th><th>Wykorzystano</th><th>Pozostało</th><th>Wnioski</th><th /></tr></thead>
          <tbody>{employees.map((employee) => {
            const id = String(employee.id);
            const balance = balanceByEmployee.get(id);
            const employment = employmentByEmployee.get(id);
            const requests = leavesByEmployee.get(id) ?? [];
            const approved = requests.filter((row) => String(row.status) === "approved");
            const pending = requests.filter((row) => ["pending", "submitted", "review"].includes(String(row.status))).length;
            const total = Number(balance?.annual_days ?? 0) + Number(balance?.carried_over_days ?? 0) + Number(balance?.extra_days ?? 0);
            const selected = selectedEmployeeId === id;
            return <Fragment key={id}>
              <tr className={selected ? styles.rowSelected : ""}>
                <td><button type="button" className={styles.employeeButton} aria-expanded={selected} onClick={() => setSelectedEmployeeId((current) => current === id ? null : id)}><strong>{employeeName(employee)}</strong><small>{str(employee.employee_number, employee.status === "active" ? "Aktywny" : employee.status)}</small></button></td>
                <td>{str(employment?.position, "Bez stanowiska")}</td>
                <td>{balance?.entitlement_configured ? `${num(total)} dni` : "Nie ustawiono"}</td>
                <td>{balance?.entitlement_configured ? `${num(balance.used_days)} dni` : "—"}</td>
                <td><strong>{balance?.entitlement_configured ? `${num(balance.remaining_days)} dni` : "—"}</strong></td>
                <td>{requests.length}{pending ? <small className={styles.pending}>{pending} do decyzji</small> : null}</td>
                <td><button type="button" className={styles.chevronButton} aria-label={selected ? "Zwiń kartę" : "Rozwiń kartę"} onClick={() => setSelectedEmployeeId((current) => current === id ? null : id)}><ChevronDown size={17} className={selected ? styles.chevronOpen : ""} /></button></td>
              </tr>
              {selected ? <tr className={styles.detailsRow}><td colSpan={7}>
                <div className={styles.details}>
                  <div className={styles.balanceGrid}>
                    <div><small>Wymiar łącznie</small><strong>{balance?.entitlement_configured ? `${num(total)} dni` : "—"}</strong></div>
                    <div><small>Wykorzystano</small><strong>{balance?.entitlement_configured ? `${num(balance.used_days)} dni` : "—"}</strong></div>
                    <div><small>Pozostało</small><strong>{balance?.entitlement_configured ? `${num(balance.remaining_days)} dni` : "—"}</strong></div>
                    <div><small>Do decyzji</small><strong>{pending}</strong></div>
                  </div>
                  <div className={styles.detailGrid}>
                    <section><header><span>Historia nieobecności</span><h3>Urlopy w {data.year} roku</h3></header>{approved.length ? <table className={styles.compactTable}><thead><tr><th>Termin</th><th>Rodzaj</th><th>Dni</th></tr></thead><tbody>{approved.map((leave) => <tr key={String(leave.id)}><td>{dateLabel(leave.date_from)} – {dateLabel(leave.date_to)}</td><td>{LEAVE_TYPES[String(leave.leave_type)] ?? str(leave.leave_type)}</td><td>{num(leave.days, 0)}</td></tr>)}</tbody></table> : <p className={styles.empty}>Brak zatwierdzonych urlopów.</p>}</section>
                    <section><header><span>Dokumentacja</span><h3>Złożone wnioski urlopowe</h3></header><div className={styles.requestList}>{requests.map((leave) => <div className={styles.requestRow} key={String(leave.id)}><div className={styles.requestMain}><FileText size={17} /><div><strong>{LEAVE_TYPES[String(leave.leave_type)] ?? "Urlop"} · {dateLabel(leave.date_from)}–{dateLabel(leave.date_to)}</strong><small>{num(leave.days,0)} dni · <b className={`${styles.status} ${statusClass(leave.status)}`}>{STATUS_LABELS[String(leave.status)] ?? str(leave.status)}</b></small></div></div><div className={styles.actions}><button type="button" onClick={() => setPreviewLeave(leave)}><Eye size={14}/> Podgląd</button><button type="button" onClick={() => downloadRequest(leave, employee, str(employment?.position,""), data.year)}><Download size={14}/> PDF</button><button type="button" onClick={() => printRequest(leave, employee, str(employment?.position,""), data.year)}><Printer size={14}/> Drukuj</button>{canApprove && ["pending","submitted","review"].includes(String(leave.status)) ? <><button type="button" disabled={busy} onClick={() => void decide(leave.id,"approved")}>Zatwierdź</button><button type="button" disabled={busy} onClick={() => void decide(leave.id,"rejected")}>Odrzuć</button></> : null}</div></div>)}{!requests.length ? <p className={styles.empty}>Brak wniosków w tym roku.</p> : null}</div></section>
                  </div>
                </div>
              </td></tr> : null}
            </Fragment>;
          })}</tbody>
        </table>
        {!employees.length ? <p className={styles.empty}>Brak pracowników pasujących do wyszukiwania.</p> : null}
      </div>
    </article>

    {previewLeave ? <div className={styles.modal} role="dialog" aria-modal="true"><button className={styles.backdrop} onClick={() => setPreviewLeave(null)} aria-label="Zamknij"/><article className={styles.preview}><header><strong>Wniosek o urlop</strong><button type="button" onClick={() => setPreviewLeave(null)}><X size={17}/></button></header><div className={styles.paper} dangerouslySetInnerHTML={{ __html: requestHtml(previewLeave, data.employees.find((employee) => String(employee.id) === String(previewLeave.employee_id)), str(employmentByEmployee.get(String(previewLeave.employee_id))?.position,""), data.year).match(/<main class="page">([\s\S]*?)<\/main>/)?.[1] ?? "" }} /></article></div> : null}
  </section>;
}
