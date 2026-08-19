"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, LoaderCircle, PackageCheck, Route } from "lucide-react";

type Row = Record<string, unknown>;
type Props = { workspaceId: string; movements: Row[]; projects: Row[]; canWrite: boolean };

export function WarehouseFlowIntegrityPanel({ workspaceId, movements, projects, canWrite }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drafts = movements.filter((row) => String(row.movement_type).toUpperCase() === "PZ" && String(row.status) === "draft");

  const act = (entity: string, payload: Record<string, unknown>) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/company/warehouse-atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, entity, payload })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Operacja magazynowa nie powiodła się.");
        return;
      }
      setMessage(entity === "stock_movement_approve"
        ? "PZ zatwierdzone. Stan, koszt i powiązanie z zakupem zostały zsynchronizowane."
        : "Zapisano miejsce dostawy i sposób rozliczenia kosztu.");
      router.refresh();
    });
  };

  return (
    <section className="ops-panel ops-panel--wide" aria-label="Szkice przyjęć magazynowych">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Przyjęcia z dokumentów</p>
          <h2>Szkice PZ do potwierdzenia</h2>
          <p>Faktura może przygotować szkic PZ. Ty wybierasz miejsce dostawy i dopiero potem zatwierdzasz faktyczne przyjęcie materiału.</p>
        </div>
      </div>

      <div className="ops-feedback-stack" aria-live="polite">
        {message ? <p className="form-message form-message--success" role="status">{message}</p> : null}
        {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
      </div>

      {!drafts.length ? (
        <p className="empty-copy"><PackageCheck size={15} aria-hidden="true" /> Brak oczekujących szkiców PZ.</p>
      ) : (
        <div className="live-record-list">
          {drafts.map((row) => <DraftRow key={String(row.id)} row={row} projects={projects} canWrite={canWrite} pending={pending} onAct={act} />)}
        </div>
      )}
    </section>
  );
}

function DraftRow({ row, projects, canWrite, pending, onAct }: { row: Row; projects: Row[]; canWrite: boolean; pending: boolean; onAct: (entity: string, payload: Record<string, unknown>) => void }) {
  const [mode, setMode] = useState(String(row.project_id ?? "") ? "direct_project" : "central_stock");
  const [projectId, setProjectId] = useState(String(row.project_id ?? ""));

  return (
    <details className="ops-task-disclosure">
      <summary>
        <Route size={17} aria-hidden="true" />
        <span>
          <strong>{String(row.document_number ?? "PZ bez numeru")}</strong>
          <small>{String(row.movement_date ?? "—")} · oczekuje na potwierdzenie miejsca dostawy</small>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="ops-task-disclosure__body">
        <p className="empty-copy">Wybierz, czy materiał pojechał bezpośrednio na inwestycję, czy został przyjęty na magazyn centralny.</p>
        {canWrite ? (
          <div className="ops-auto-form-grid">
            <label>Przeznaczenie<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="direct_project">Bezpośrednio na inwestycję</option><option value="central_stock">Magazyn centralny</option></select></label>
            <label>Inwestycja<select value={projectId} disabled={mode !== "direct_project"} onChange={(event) => setProjectId(event.target.value)}><option value="">Wybierz inwestycję</option>{projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{String(project.name)}</option>)}</select></label>
          </div>
        ) : null}
        {canWrite ? (
          <div className="ops-task-disclosure__actions">
            <button type="button" disabled={pending || (mode === "direct_project" && !projectId)} onClick={() => onAct("stock_movement_destination", { movementId: row.id, destinationMode: mode, projectId: mode === "direct_project" ? projectId : null })}>
              {pending ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}Zapisz miejsce dostawy
            </button>
            <button type="button" disabled={pending || (mode === "direct_project" && !projectId)} onClick={() => onAct("stock_movement_approve", { movementId: row.id, projectId: mode === "direct_project" ? projectId : null })}>
              <CheckCircle2 size={14} aria-hidden="true" />Zatwierdź PZ
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
