"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck } from "lucide-react";
import type { HrRow, HrWorkspaceData } from "@/lib/hr/types";
import styles from "./hr-core-300.module.css";

function str(value: unknown, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function normalize(value: unknown) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[łŁ]/g, "l").toLowerCase(); }
function employeeName(row?: HrRow) { return row ? `${str(row.first_name, "")} ${str(row.last_name, "")}`.trim() || str(row.employee_number) : "Pracownik"; }
function dateLabel(value: unknown) { if (!value) return "—"; const raw = String(value).slice(0, 10); const d = new Date(`${raw}T00:00:00Z`); return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("pl-PL", { timeZone: "UTC" }); }
function itemType(row: HrRow) { return str(row.item_type ?? row.qualification_type ?? row.exam_type ?? row.training_type); }
function itemKind(row: HrRow) { return String(row.item_kind ?? (row.qualification_type ? "qualification" : row.exam_type ? "medical_exam" : "safety_training")); }
function kindLabel(row: HrRow) { const kind = itemKind(row); return kind === "medical_exam" ? "Badanie" : kind === "safety_training" ? "BHP" : "Uprawnienie"; }
function state(row: HrRow, referenceDate: string) {
  const status = normalize(row.status);
  if (["archived", "unfit", "expired"].includes(status)) return "bad";
  const validUntil = row.valid_until ? String(row.valid_until).slice(0, 10) : "";
  if (!validUntil) return "neutral";
  const days = Math.round((new Date(`${validUntil}T00:00:00Z`).getTime() - new Date(`${referenceDate}T00:00:00Z`).getTime()) / 86_400_000);
  if (days < 0) return "bad";
  if (days <= 30) return "warn";
  return "ok";
}

export function HrComplianceCore300({ workspaceId, data, canWrite }: { workspaceId: string; data: HrWorkspaceData; canWrite: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("attention");
  const [employeeId, setEmployeeId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const employeeById = useMemo(() => new Map(data.employees.map((row) => [String(row.id), row])), [data.employees]);
  const rows = useMemo(() => data.complianceItems
    .filter((row) => normalize(row.status) !== "archived")
    .filter((row) => !employeeId || String(row.employee_id) === employeeId)
    .filter((row) => {
      if (scope === "all") return true;
      const current = state(row, data.referenceDate);
      return scope === "attention" ? current === "bad" || current === "warn" : current === scope;
    })
    .filter((row) => {
      if (!query.trim()) return true;
      const employee = employeeById.get(String(row.employee_id));
      return normalize(`${employeeName(employee)} ${itemType(row)} ${row.number ?? ""} ${row.provider ?? ""}`).includes(normalize(query));
    })
    .sort((a, b) => String(a.valid_until ?? "9999-12-31").localeCompare(String(b.valid_until ?? "9999-12-31"))), [data.complianceItems, data.referenceDate, employeeById, employeeId, query, scope]);

  const submit = (action: "medical_exam_create" | "safety_training_create" | "qualification_create", success: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    setFeedback(null); setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/hr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, action, payload }) });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać wpisu.");
        form.reset();
        setFeedback(success);
        router.refresh();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Nie udało się zapisać wpisu."); }
    });
  };

  return <section className={styles.panel} data-hr-core-compliance="300">
    <header className={styles.panelHeader}><div><p className={styles.kicker}>Centralna ewidencja</p><h2>Uprawnienia, badania i BHP</h2></div><ShieldCheck size={20} /></header>
    <div className={styles.complianceToolbar}>
      <input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj pracownika, SEP, UDT, BHP…" />
      <select className={styles.select} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Wszyscy pracownicy</option>{data.employees.filter((row) => row.status === "active").map((row) => <option value={String(row.id)} key={String(row.id)}>{employeeName(row)}</option>)}</select>
      <select className={styles.select} value={scope} onChange={(event) => setScope(event.target.value)}><option value="attention">Wymaga uwagi</option><option value="bad">Po terminie</option><option value="warn">≤30 dni</option><option value="all">Wszystkie</option></select>
    </div>
    {feedback ? <div className={styles.feedback}>{feedback}</div> : null}{error ? <div className={styles.error}>{error}</div> : null}
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Pracownik</th><th>Rodzaj</th><th>Typ</th><th>Numer / organizator</th><th>Ważne do</th><th>Status</th></tr></thead><tbody>{rows.map((row) => {
      const current = state(row, data.referenceDate);
      return <tr key={`${itemKind(row)}-${String(row.id)}`}><td><strong>{employeeName(employeeById.get(String(row.employee_id)))}</strong></td><td>{kindLabel(row)}</td><td>{itemType(row)}</td><td>{str(row.number ?? row.provider)}</td><td>{dateLabel(row.valid_until)}</td><td><span className={`${styles.state} ${current === "bad" ? styles.stateBad : current === "warn" ? styles.stateWarn : styles.stateOk}`}>{current === "bad" ? "Po terminie" : current === "warn" ? "Wygasa" : current === "neutral" ? "Bez terminu" : "Aktualne"}</span></td></tr>;
    })}</tbody></table>{!rows.length ? <div className={styles.empty}>Brak wpisów dla wybranego filtra.</div> : null}</div>

    {canWrite ? <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <details><summary><Plus size={13} /> Dodaj badanie lekarskie</summary><form className={styles.formGrid} onSubmit={submit("medical_exam_create", "Badanie zapisane.")}>
        <label>Pracownik<select name="employeeId" required defaultValue=""><option value="">Wybierz</option>{data.employees.filter((row) => row.status === "active").map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label>
        <label>Rodzaj<input name="examType" required placeholder="Okresowe" /></label><label>Data badania<input name="examinedAt" type="date" /></label><label>Ważne do<input name="validUntil" type="date" required /></label>
        <label>Wynik<select name="result" defaultValue="fit"><option value="fit">Zdolny</option><option value="fit_with_restrictions">Z ograniczeniami</option><option value="unfit">Niezdolny</option></select></label><div className={styles.formActions}><button className={styles.action} disabled={pending}>Zapisz</button></div>
      </form></details>
      <details><summary><Plus size={13} /> Dodaj szkolenie BHP</summary><form className={styles.formGrid} onSubmit={submit("safety_training_create", "Szkolenie BHP zapisane.")}>
        <label>Pracownik<select name="employeeId" required defaultValue=""><option value="">Wybierz</option>{data.employees.filter((row) => row.status === "active").map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label>
        <label>Rodzaj<input name="trainingType" required placeholder="Okresowe" /></label><label>Organizator<input name="provider" /></label><label>Ukończono<input name="completedAt" type="date" required /></label><label>Ważne do<input name="validUntil" type="date" /></label><div className={styles.formActions}><button className={styles.action} disabled={pending}>Zapisz</button></div>
      </form></details>
      <details><summary><Plus size={13} /> Dodaj uprawnienie / certyfikat</summary><form className={styles.formGrid} onSubmit={submit("qualification_create", "Uprawnienie zapisane.")}>
        <label>Pracownik<select name="employeeId" required defaultValue=""><option value="">Wybierz</option>{data.employees.filter((row) => row.status === "active").map((row) => <option key={String(row.id)} value={String(row.id)}>{employeeName(row)}</option>)}</select></label>
        <label>Rodzaj<input name="qualificationType" required placeholder="SEP / UDT / F-Gazy" /></label><label>Numer<input name="number" /></label><label>Wydano<input name="issuedAt" type="date" /></label><label>Ważne do<input name="validUntil" type="date" /></label><div className={styles.formActions}><button className={styles.action} disabled={pending}>Zapisz</button></div>
      </form></details>
    </div> : null}
  </section>;
}
