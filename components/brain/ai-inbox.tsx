"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileCheck2, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { AiInboxItem } from "@/lib/data/operations";

const TABS: Array<{ key: AiInboxItem["status"] | "all"; label: string }> = [
  { key: "all", label: "Wszystkie" }, { key: "new", label: "Nowe" }, { key: "processing", label: "Przetwarzane" },
  { key: "review", label: "Wymaga decyzji" }, { key: "error", label: "Błąd" }, { key: "ready", label: "Gotowe" }, { key: "rejected", label: "Odrzucone" }
];

const STATUS_LABEL: Record<AiInboxItem["status"], string> = {
  new: "Nowe", processing: "Przetwarzane", review: "Wymaga decyzji", error: "Błąd", ready: "Gotowe", rejected: "Odrzucone"
};

export function AiInbox({ items, workspaceId }: { items: AiInboxItem[]; workspaceId?: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const filtered = useMemo(() => tab === "all" ? items : items.filter((item) => item.status === tab), [items, tab]);

  function decide(item: AiInboxItem, action: "approve" | "reject") {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/brain/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, entityType: item.entityType, entityId: item.id, action })
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

  return (
    <section className="ai-inbox">
      <div className="ai-inbox__tabs" role="tablist" aria-label="Statusy Skrzynki AI">
        {TABS.map((item) => {
          const count = item.key === "all" ? items.length : items.filter((entry) => entry.status === item.key).length;
          return <button key={item.key} type="button" role="tab" onClick={() => setTab(item.key)} aria-selected={tab === item.key}>{item.label}<span>{count}</span></button>;
        })}
      </div>
      {message ? <p className="action-message">{message}</p> : null}
      <div className="ai-inbox__list">
        {filtered.length === 0 ? <div className="empty-state"><FileCheck2 size={26} /><strong>Brak elementów w tym stanie</strong><span>Skrzynka pokaże dokumenty, importy, zmiany i zdarzenia wymagające decyzji.</span></div> : null}
        {filtered.map((item) => (
          <article key={`${item.entityType}-${item.id}`} className="ai-inbox-row">
            <span className={`ai-inbox-row__state ai-inbox-row__state--${item.status}`}>
              {item.status === "error" ? <AlertTriangle size={17} /> : item.status === "processing" ? <LoaderCircle className="spin" size={17} /> : <FileCheck2 size={17} />}
            </span>
            <div className="ai-inbox-row__body">
              <div className="ai-inbox-row__meta"><span>{item.subtitle}</span><span>{item.category}</span><span>{new Date(item.createdAt).toLocaleString("pl-PL")}</span></div>
              <h3>{item.title}</h3><p>{item.detail}</p>
            </div>
            <div className="ai-inbox-row__decision">
              <span className={`status-chip status-chip--${item.status}`}>{STATUS_LABEL[item.status]}</span>
              {item.confidence != null ? <small>Pewność AI: {Math.round(item.confidence * 100)}%</small> : null}
              {item.status === "review" ? <div><button type="button" className="approve-button" onClick={() => decide(item, "approve")} disabled={pending}><Check size={15} />Zatwierdź</button><button type="button" className="reject-button" onClick={() => decide(item, "reject")} disabled={pending}><X size={15} />Odrzuć</button></div> : null}
              {item.status === "error" && item.entityType === "document" ? <button type="button" className="secondary-button" onClick={() => retry(item)} disabled={pending}><RotateCcw size={15} />Ponów z kolejki</button> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
