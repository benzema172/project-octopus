"use client";

import { useEffect, useState } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import styles from "./hr-accounting-bridge-160.module.css";

type Row = Record<string, unknown>;
type BridgeResponse = {
  ok: boolean;
  period: string;
  canViewPayroll: boolean;
  summary: {
    employees: number;
    ready: number;
    blocked: number;
    pendingTimesheets: number;
    missingPayroll: number;
    missingCostSnapshot: number;
    totalEmployerCost: number | null;
    laborCostSnapshot: number | null;
  };
  rows: Row[];
};

type Props = {
  workspaceId: string;
  referenceDate: string;
};

const VALIDATION_LABELS: Record<string, string> = {
  BRAK_WARUNKOW_ZATRUDNIENIA: "brak warunków zatrudnienia",
  CZAS_DO_ZATWIERDZENIA: "czas pracy do zatwierdzenia",
  BRAK_ZAMKNIECIA_PLAC: "brak miesięcznego rozliczenia płac",
  BRAK_SNAPSHOT_KOSZTU: "zatwierdzony czas bez zamrożonego kosztu",
  URLOP_PRZECHODZI_MIESIAC: "urlop przechodzi przez granicę miesiąca"
};

function num(value: unknown, digits = 1) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number.isFinite(parsed) ? parsed : 0);
}
function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number.isFinite(parsed) ? parsed : 0);
}
function str(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

export function HrAccountingBridge160({ workspaceId, referenceDate }: Props) {
  const [period, setPeriod] = useState(referenceDate.slice(0, 7));
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<BridgeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ workspaceId, period });
    fetch(`/api/company/hr/accounting-bridge?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as BridgeResponse & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Nie udało się przygotować mostu księgowego.");
        return result;
      })
      .then((result) => { setData(result); setError(null); })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Nie udało się przygotować mostu księgowego.");
      });
    return () => controller.abort();
  }, [workspaceId, period, reloadKey]);

  const summary = data?.summary;
  const downloadHref = `/api/company/hr/accounting-bridge?${new URLSearchParams({ workspaceId, period, download: "1" }).toString()}`;

  return <section className={styles.panel} data-hr-accounting-bridge="1">
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>Most księgowy v1</p>
        <h2>Miesięczne zamknięcie danych kadrowych</h2>
        <p>Octopus sprawdza czas pracy, urlopy, rozliczenie płac i koszty przed eksportem. Pierwszy adapter jest uniwersalnym CSV, dzięki czemu warstwa Kadr nie jest uzależniona od jednego programu księgowego.</p>
      </div>
      <div className={styles.controls}>
        <input className={styles.month} type="month" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Miesiąc eksportu księgowego" />
        <button className={styles.button} type="button" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw size={14} /> Sprawdź</button>
        {data?.canViewPayroll ? <a className={styles.download} href={downloadHref}><Download size={14} /> Eksport CSV</a> : null}
      </div>
    </header>

    <div className={styles.metrics}>
      <div className={styles.metric}><small>Pracownicy</small><strong>{num(summary?.employees, 0)}</strong><span>objęci miesiącem</span></div>
      <div className={styles.metric}><small>Gotowi</small><strong>{num(summary?.ready, 0)}</strong><span>bez blokujących błędów</span></div>
      <div className={styles.metric}><small>Wymaga poprawy</small><strong>{num(summary?.blocked, 0)}</strong><span>{num(summary?.pendingTimesheets, 0)} kart czasu oczekuje</span></div>
      <div className={styles.metric}><small>Koszt pracodawcy</small><strong>{data?.canViewPayroll && summary?.totalEmployerCost != null ? money(summary.totalEmployerCost) : "Ukryty"}</strong><span>{num(summary?.missingPayroll, 0)} bez zamknięcia płac</span></div>
      <div className={styles.metric}><small>Robocizna z kart czasu</small><strong>{data?.canViewPayroll && summary?.laborCostSnapshot != null ? money(summary.laborCostSnapshot) : "Ukryta"}</strong><span>{num(summary?.missingCostSnapshot, 0)} wpisów bez kosztu</span></div>
    </div>

    <div className={styles.body}>
      <div className={`${styles.notice} ${summary && summary.blocked === 0 ? styles.okNotice : ""}`}>
        <ShieldCheck size={14} /> {summary && summary.blocked === 0
          ? "Pakiet nie ma blokujących braków i może zostać przekazany do księgowości. Ostrzeżenia o urlopach przechodzących przez miesiące pozostają informacyjne."
          : "Przed eksportem popraw pozycje oznaczone jako wymagające decyzji. CSV pozostaje formatem pośrednim; docelowe adaptery do konkretnego programu będą korzystać z tego samego kontraktu danych."}
      </div>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Pracownik</th><th>Czas</th><th>Urlop</th><th>Płace</th><th>Inwestycje / kody</th><th>Walidacja</th><th>Status</th></tr></thead>
          <tbody>{(data?.rows ?? []).map((row) => {
            const validation = Array.isArray(row.validation) ? row.validation.map(String) : [];
            return <tr key={String(row.employeeId)}>
              <td><div className={styles.person}><strong>{str(row.employeeName)}</strong><span>{str(row.employeeNumber)} · {str(row.position, "bez stanowiska")}</span></div></td>
              <td><div className={styles.person}><strong>{num(Number(row.regularHours ?? 0) + Number(row.overtimeHours ?? 0), 2)} h</strong><span>{num(row.overtimeHours, 2)} h nadg. · {num(row.pendingEntries, 0)} oczekuje</span></div></td>
              <td>{num(row.approvedLeaveDays, 1)} dni</td>
              <td><div className={styles.person}><strong>{str(row.payrollStatus, "planned")}</strong><span>{str(row.payrollSource, "plan zatrudnienia")}</span></div></td>
              <td>{str(row.projectsAndCostCodes)}</td>
              <td className={styles.validation}>{validation.length ? validation.map((code) => VALIDATION_LABELS[code] ?? code).join(" · ") : "brak błędów"}</td>
              <td><span className={`${styles.chip} ${row.ready ? styles.ready : styles.blocked}`}>{row.ready ? "Gotowe" : "Do poprawy"}</span></td>
            </tr>;
          })}</tbody>
        </table>
        {!data?.rows?.length && !error ? <div className={styles.empty}>Brak danych pracowników dla wybranego miesiąca.</div> : null}
      </div>
    </div>
  </section>;
}
