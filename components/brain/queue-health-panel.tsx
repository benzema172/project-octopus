import { AlertTriangle, CheckCircle2, Clock3, Cpu, Database, HeartPulse } from "lucide-react";
import type { ProcessingQueueHealth } from "@/lib/data/operations";
import { QueueWorkerButton } from "@/components/brain/queue-worker-button";

export function QueueHealthPanel({ health, workspaceId, canRunWorker }: { health: ProcessingQueueHealth; workspaceId: string; canRunWorker: boolean }) {
  const label = health.state === "healthy" ? "Kolejka zdrowa" : health.state === "warning" ? "Kolejka wymaga uwagi" : "Kolejka wymaga działania";
  return <section className={`section-band queue-health queue-health--${health.state}`}>
    <div className="section-heading"><div><p className="eyebrow">Monitoring AI</p><h2>{label}</h2><p>Stan z {new Date(health.checkedAt).toLocaleString("pl-PL")}. Zadanie aktywne bez heartbeat przez 15 minut jest oznaczane jako zawieszone.</p></div>{health.state === "healthy" ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}</div>
    <div className="live-domain-grid">
      <article><Database size={18} /><span>Oczekujące</span><strong>{health.queued}</strong><small>{health.oldestQueuedMinutes == null ? "brak kolejki" : `najstarsze: ${health.oldestQueuedMinutes} min`}</small></article>
      <article><Cpu size={18} /><span>Przetwarzane</span><strong>{health.running}</strong><small>{health.staleRunning} bez heartbeat</small></article>
      <article><AlertTriangle size={18} /><span>Dead letter</span><strong>{health.deadLetter}</strong><small>{health.failed24h} błędów / 24 h</small></article>
      <article><CheckCircle2 size={18} /><span>Sukces / 24 h</span><strong>{health.succeeded24h}</strong><small>koszt est. {health.estimatedCost24h.toFixed(4)} USD</small></article>
      <article><HeartPulse size={18} /><span>Ostatni heartbeat</span><strong>{health.lastHeartbeatAt ? new Date(health.lastHeartbeatAt).toLocaleTimeString("pl-PL") : "—"}</strong><small>{health.lastHeartbeatAt ? new Date(health.lastHeartbeatAt).toLocaleDateString("pl-PL") : "worker jeszcze nie pracował"}</small></article>
      <article><Clock3 size={18} /><span>Próg ostrzeżenia</span><strong>10 min</strong><small>zawieszenie po 15 min</small></article>
    </div>
    {canRunWorker ? <QueueWorkerButton workspaceId={workspaceId} /> : null}
  </section>;
}
