"use client";

import { useState, useTransition } from "react";
import { Download, Eye, FileOutput, LoaderCircle } from "lucide-react";
import { ReviewDecisionButton } from "@/components/projects/review-decision-button";

type PublishedOutput = { id: string; name: string; runId: string; versionId: string; createdAt: string };
type DraftOutput = { id: string; label: string; createdAt: string; warningCount: number; canApprove: boolean };

export function GeneratedOutputList({ workspaceId, projectId, outputs, drafts }: { workspaceId: string; projectId: string; outputs: PublishedOutput[]; drafts: DraftOutput[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function download(versionId: string) {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/storage/download-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, projectId, versionId })
      });
      const payload = await response.json() as { downloadUrl?: string; error?: string };
      if (!response.ok || !payload.downloadUrl) {
        setMessage(payload.error ?? "Nie udało się przygotować pobierania.");
        return;
      }
      window.location.assign(payload.downloadUrl);
    });
  }

  return <section className="section-band live-records"><div className="section-heading"><div><p className="eyebrow">Kontrolowane generowanie</p><h2>Szkice i opublikowane wyniki</h2></div><span>{outputs.length} opublikowanych · {drafts.length} szkiców</span></div>{message ? <p className="action-message">{message}</p> : null}<div className="live-record-list">{drafts.map((draft) => <article key={draft.id}><FileOutput size={18} /><div><strong>{draft.label}</strong><small>Szkic · {new Date(draft.createdAt).toLocaleString("pl-PL")} · ostrzeżenia: {draft.warningCount}</small></div><a className="secondary-button" href={`/api/templates/generate?runId=${draft.id}`} target="_blank" rel="noreferrer"><Eye size={15} />Podgląd</a>{draft.canApprove ? <ReviewDecisionButton entityType="generation_run" entityId={draft.id} workspaceId={workspaceId} /> : <small>Publikacja wymaga zatwierdzania we Wzorach i domenie dokumentu.</small>}</article>)}{outputs.map((output) => <article key={output.id}><FileOutput size={18} /><div><strong>{output.name}</strong><small>Opublikowany · {new Date(output.createdAt).toLocaleString("pl-PL")} · wersja zapisana w R2</small></div><div className="review-buttons"><a className="secondary-button" href={`/api/templates/generate?runId=${output.runId}`} target="_blank" rel="noreferrer"><Eye size={15} />Otwórz</a><button type="button" className="secondary-button" disabled={pending} onClick={() => download(output.versionId)}>{pending ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}Pobierz HTML</button></div></article>)}{outputs.length === 0 && drafts.length === 0 ? <div className="empty-state"><FileOutput size={24} /><strong>Brak dokumentów wynikowych</strong><span>Utwórz szkic w Studio Wzorów. Po zatwierdzeniu pojawi się tutaj jako wersjonowany plik.</span></div> : null}</div></section>;
}
