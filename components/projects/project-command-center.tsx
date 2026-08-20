"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, CheckCircle2, CircleDollarSign, HeartPulse, RefreshCcw } from "lucide-react";

type Row = Record<string, unknown>;
type Data = { snapshot: Record<string, unknown>; anomalies: Row[]; correspondence: Row[]; resources: Row[]; employees: Row[] };

const money = (value: unknown) => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number(value ?? 0));
function obj(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function arr(value: unknown) { return Array.isArray(value) ? value as Row[] : []; }

export function ProjectCommandCenter({ projectId, data, canManage }: { projectId: string; data: Data; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const snapshot = data.snapshot;
  const forecast = obj(snapshot.forecast);
  const schedule = obj(snapshot.schedule);
  const anomalyStats = obj(snapshot.anomalies);
  const quality = obj(snapshot.quality);
  const health = obj(snapshot.projectHealth);
  const cash = arr(snapshot.cashflow13w);
  const activeAnomalies = data.anomalies.filter((row) => row.status !== "resolved");
  const healthScore = String(health.score ?? "—");
  const healthStatus = String(health.status ?? "—");

  async function action(actionName: string, payload: Record<string, unknown>) {
    setMessage(null);
    const response = await fetch("/api/projects/command-center", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: actionName, payload })
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Operacja nie powiodła się.");
    setMessage("Zapisano.");
    startTransition(() => router.refresh());
  }

  return <section className="control360-panel control360-command">
    <header className="control360-panel__heading">
      <div>
        <p className="co-kicker">Stan inwestycji</p>
        <h2><HeartPulse size={20} /> {healthScore}/100 <span>{healthStatus}</span></h2>
      </div>
      <span className="control360-live">{pending ? <RefreshCcw size={14} /> : <CheckCircle2 size={14} />} na żywo</span>
    </header>

    {message ? <p className="command-message">{message}</p> : null}

    <div className="control360-priority">
      <span>Aktualny priorytet</span>
      <strong>{String(snapshot.nextAction ?? "Brak pilnych czynności")}</strong>
    </div>

    <div className="control360-metrics">
      <article><CircleDollarSign /><span><small>Kontrakt</small><strong>{money(snapshot.contractValue)}</strong></span></article>
      <article><CalendarClock /><span><small>Prognoza końca</small><strong>{String(forecast.finishDate ?? schedule.latestOpenFinish ?? "—")}</strong></span></article>
      <article className={Number(anomalyStats.open ?? 0) > 0 ? "is-warning" : ""}><AlertTriangle /><span><small>Do uwagi</small><strong>{String(anomalyStats.open ?? 0)}</strong></span></article>
      <article><CheckCircle2 /><span><small>Odebrany przerób</small><strong>{money(snapshot.acceptedProgressValue)}</strong></span></article>
    </div>

    {activeAnomalies.length ? <section className="control360-alerts">
      <div className="control360-subheading"><strong>Wymaga uwagi</strong><span>{activeAnomalies.length}</span></div>
      {activeAnomalies.slice(0, 5).map((anomaly) => <div key={String(anomaly.id)} className="control360-alert-row">
        <AlertTriangle size={15} />
        <div><strong>{String(anomaly.title)}</strong><small>{String(anomaly.detail ?? anomaly.category ?? "")}</small></div>
        {canManage ? <div className="control360-row-actions"><button onClick={() => action("anomaly_acknowledge", { anomalyId: anomaly.id })}>Przyjmij</button><button onClick={() => action("anomaly_resolve", { anomalyId: anomaly.id })}>Zamknij</button></div> : null}
      </div>)}
    </section> : <div className="control360-ok"><CheckCircle2 size={15} /> Brak aktywnych anomalii i pilnych sygnałów</div>}

    <details className="control360-details">
      <summary>Finanse i cash flow <span>EAC {money(forecast.eac)} · marża {money(forecast.margin)} · {String(quality.missingEvidence ?? 0)} braków dowodowych</span></summary>
      <div className="control360-cashflow">
        {cash.map((week) => <article key={String(week.weekStart)}><small>{String(week.weekStart)}</small><span><ArrowUp size={12} /> {money(week.inflow)}</span><span><ArrowDown size={12} /> {money(week.outflow)}</span><b>{money(week.net)}</b></article>)}
        {!cash.length ? <p className="empty-copy">Brak danych cash flow.</p> : null}
      </div>
    </details>
  </section>;
}
