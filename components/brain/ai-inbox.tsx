"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock3, FileCheck2, LoaderCircle, RotateCcw, UserRoundCheck, X } from "lucide-react";
import { DOCUMENT_DESTINATIONS, documentCategoryLabel, normalizeDocumentCategory } from "@/lib/documents/classification";
import type { AiInboxItem, AiInboxProjectOption } from "@/lib/data/operations";

const TABS: Array<{ key: AiInboxItem["status"] | "all"; label: string }> = [
  { key: "all", label: "Wszystkie" }, { key: "new", label: "Nowe" }, { key: "processing", label: "Przetwarzane" },
  { key: "review", label: "Wymaga decyzji" }, { key: "error", label: "Błąd" }, { key: "ready", label: "Gotowe" }, { key: "rejected", label: "Odrzucone" }
];

const STATUS_LABEL: Record<AiInboxItem["status"], string> = {
  new: "Nowe", processing: "Przetwarzane", review: "Wymaga decyzji", error: "Błąd", ready: "Gotowe", rejected: "Odrzucone"
};

type DocumentCorrection = { category: string; projectId: string };

export function AiInbox({
  items,
  workspaceId,
  projects = [],
  currentUserId
}: {
  items: AiInboxItem[];
  workspaceId?: string;
  projects?: AiInboxProjectOption[];
  currentUserId?: string;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, DocumentCorrection>>({});
  const [onlyMine, setOnlyMine] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const filtered = useMemo(() => items.filter((item) => (tab === "all" || item.status === tab) && (!onlyMine || item.assignedTo === currentUserId)), [currentUserId, items, onlyMine, tab]);

  function documentCorrection(item: AiInboxItem): DocumentCorrection {
    return corrections[item.id] ?? {
      category: normalizeDocumentCategory(item.category) ?? "other",
      projectId: item.proposedProjectId ?? item.projectId ?? ""
    };
  }

  function updateDocumentCorrection(item: AiInboxItem, patch: Partial<DocumentCorrection>) {
    setCorrections((current) => ({
      ...current,
      [item.id]: {
        ...(current[item.id] ?? {
          category: normalizeDocumentCategory(item.category) ?? "other",
          projectId: item.proposedProjectId ?? item.projectId ?? ""
        }),
        ...patch
      }
    }));
  }

  function decide(item: AiInboxItem, action: "approve" | "reject") {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/brain/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          entityType: item.entityType,
          entityId: item.id,
          action,
          ...(item.entityType === "document" ? {
            category: documentCorrection(item).category,
            projectId: documentCorrection(item).projectId || null,
            projectSelectionSet: true
          } : {})
        })
      });
      const payload = await response.json() as { error?: string };
      setMessage(response.ok ? (action === "approve" ? "Element został zatwierdzony." : "Element został odrzucony.") : payload.error ?? "Nie udało się zapisać decyzji.");
      if (response.ok) router.refresh();
    });
  }

  function retry(item: AiInboxItem) {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/brain/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, documentId: item.id }) });
      const payload = await response.json() as { error?: string };
      setMessage(response.ok ? "Dokument wrócił do kolejki." : payload.error ?? "Nie udało się ponowić analizy.");
      if (response.ok) router.refresh();
    });
  }

  function triage(item: AiInboxItem, action: "claim" | "release" | "priority", priority?: "low" | "normal" | "high" | "critical") {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/brain/triage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, documentId: item.id, action, priority })
      });
      const payload = await response.json() as { error?: string };
      setMessage(response.ok ? "Kolejka decyzji została zaktualizowana." : payload.error ?? "Nie udało się zaktualizować kolejki.");
      if (response.ok) router.refresh();
    });
  }

  return (
    <section className="ai-inbox">
      <div className="ai-inbox__tabs" role="tablist" aria-label="Statusy Skrzynki AI">
        {TABS.map((item) => {
          const count = item.key === "all" ? items.length : items.filter((entry) => entry.status === item.key).length;
          return <button key={item.key} type="button" role="tab" onClick={() => setTab(item.key)} aria-selected={tab === item.key}>{item.label}<span>{count}</span></button>;
        })}
        <button type="button" className={onlyMine ? "is-active" : undefined} onClick={() => setOnlyMine((value) => !value)} aria-pressed={onlyMine}><UserRoundCheck size={14} />Moje</button>
      </div>
      {message ? <p className="action-message">{message}</p> : null}
      <div className="ai-inbox__list">
        {filtered.length === 0 ? <div className="empty-state"><FileCheck2 size={26} /><strong>Brak elementów w tym stanie</strong><span>Skrzynka pokaże dokumenty, importy, zmiany i zdarzenia wymagające decyzji.</span></div> : null}
        {filtered.map((item) => {
          const correction = item.entityType === "document" ? documentCorrection(item) : null;
          const canWrite = item.canWrite !== false;
          const canApprove = item.canApprove !== false;
          return (
          <article key={`${item.entityType}-${item.id}`} className="ai-inbox-row">
            <span className={`ai-inbox-row__state ai-inbox-row__state--${item.status}`}>
              {item.status === "error" ? <AlertTriangle size={17} /> : item.status === "processing" ? <LoaderCircle className="spin" size={17} /> : <FileCheck2 size={17} />}
            </span>
            <div className="ai-inbox-row__body">
              <div className="ai-inbox-row__meta"><span>{item.subtitle}</span><span>{documentCategoryLabel(item.category)}</span>{item.channel ? <span>{item.channel}</span> : null}<span>{new Date(item.createdAt).toLocaleString("pl-PL")}</span></div>
              <h3>{item.title}</h3><p>{item.detail}</p>
              {item.entityType === "document" && item.status === "review" && correction ? (
                <div className="ai-inbox-row__routing">
                  <label>
                    <span>Kategoria docelowa{item.categoryLocked ? " · zablokowana przy wysyłaniu" : ""}</span>
                    <select
                      value={correction.category}
                      onChange={(event) => updateDocumentCorrection(item, { category: event.target.value })}
                      disabled={pending || !canApprove}
                      aria-label={`Kategoria dokumentu ${item.title}`}
                    >
                      {DOCUMENT_DESTINATIONS.map((destination) => (
                        <option key={destination.value} value={destination.value}>{destination.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Przypisanie do inwestycji</span>
                    <select
                      value={correction.projectId}
                      onChange={(event) => updateDocumentCorrection(item, { projectId: event.target.value })}
                      disabled={pending || !canApprove}
                      aria-label={`Inwestycja dokumentu ${item.title}`}
                    >
                      <option value="">Dokument firmowy / bez inwestycji</option>
                      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                  </label>
                  <small>
                    {item.proposedProjectName
                      ? `Propozycja AI: ${item.proposedProjectName}`
                      : item.matchStatus === "ambiguous"
                        ? "AI wykryło niejednoznaczne dopasowanie."
                        : "AI nie przypisało inwestycji."}
                  </small>
                  <label>
                    <span>Priorytet decyzji</span>
                    <select value={item.priority ?? "normal"} onChange={(event) => triage(item, "priority", event.target.value as "low" | "normal" | "high" | "critical")} disabled={pending || !canWrite}>
                      <option value="low">Niski</option><option value="normal">Normalny</option><option value="high">Wysoki</option><option value="critical">Krytyczny</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
            <div className="ai-inbox-row__decision">
              <span className={`status-chip status-chip--${item.status}`}>{STATUS_LABEL[item.status]}</span>
              {item.confidence != null ? <small>Pewność AI: {Math.round(item.confidence * 100)}%</small> : null}
              {item.reviewDueAt ? <small className={item.overdue ? "ai-inbox-row__overdue" : undefined}><Clock3 size={13} /> {item.overdue ? "Po SLA · " : "SLA · "}{new Date(item.reviewDueAt).toLocaleString("pl-PL")}{item.escalationLevel ? ` · eskalacja ${item.escalationLevel}` : ""}</small> : null}
              {item.entityType === "document" && item.status === "review" && canWrite && (!item.assignedTo || item.assignedTo === currentUserId || canApprove) ? <button type="button" className="secondary-button" onClick={() => triage(item, item.assignedTo === currentUserId ? "release" : "claim")} disabled={pending}>{item.assignedTo === currentUserId ? "Zwolnij" : item.assignedTo ? "Przejmij" : "Przypisz do mnie"}</button> : null}
              {item.status === "review" && canApprove ? <div><button type="button" className="approve-button" onClick={() => decide(item, "approve")} disabled={pending}><Check size={15} />Zatwierdź</button><button type="button" className="reject-button" onClick={() => decide(item, "reject")} disabled={pending}><X size={15} />Odrzuć</button></div> : null}
              {item.status === "error" && item.entityType === "document" && canWrite ? <button type="button" className="secondary-button" onClick={() => retry(item)} disabled={pending}><RotateCcw size={15} />Ponów z kolejki</button> : null}
            </div>
          </article>
        );})}
      </div>
    </section>
  );
}
