"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, GitMerge, Link2, LoaderCircle, RefreshCw, ShieldCheck, Split, UploadCloud } from "lucide-react";
import type { UnifiedDocumentFlowData, UnifiedDocumentReview } from "@/lib/data/unified-document-flow";

function money(value: number) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(value || 0);
}
function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("pl-PL");
}
function reviewLabel(review: UnifiedDocumentReview) {
  if (review.type === "duplicate_candidate") return "Możliwy duplikat";
  if (review.type === "source_conflict") return "Konflikt źródeł";
  return "Do przypisania";
}

export function UnifiedDocumentFlow({ workspaceId, data, canWrite, canApprove }: { workspaceId: string; data: UnifiedDocumentFlowData; canWrite: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectByReview, setProjectByReview] = useState<Record<string, string>>(() => Object.fromEntries(data.reviews.filter((review) => review.suggestedProjectId).map((review) => [review.id, review.suggestedProjectId as string])));

  const act = (reviewId: string, action: "assign_project" | "duplicate_same" | "duplicate_distinct" | "dismiss", projectId?: string) => {
    setMessage(null); setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/unified-document-flow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, reviewId, action, projectId: projectId || null })
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Nie udało się zapisać decyzji.");
        setMessage(action === "assign_project" ? "Faktura została przypisana. Finanse inwestycji, Magazyn i powiązane dane korzystają teraz z tej samej decyzji." : action === "duplicate_same" ? "Źródła zostały połączone z jedną kanoniczną fakturą." : action === "duplicate_distinct" ? "Dokument został potwierdzony jako osobna faktura i przetworzony." : "Decyzja została zamknięta.");
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Operacja nie powiodła się.");
      }
    });
  };

  return <section className="udf-shell" aria-label="Unified Document and Finance Flow">
    <div className="udf-heading">
      <div><span>Unified Document & Finance Flow</span><h2>Jedna faktura · wiele źródeł · jedna prawda</h2><p>Wrzutnia, KSeF i kolejne integracje trafiają do jednego dokumentu kanonicznego. Octopus rozdziela jego skutki do Finansów, Magazynu i właściwej inwestycji bez tworzenia kopii.</p></div>
      <div className="udf-flow"><span><UploadCloud size={15}/> Wrzutnia / KSeF</span><b>→</b><span><ShieldCheck size={15}/> kontrola AI</span><b>→</b><span><GitMerge size={15}/> faktura kanoniczna</span><b>→</b><span><Split size={15}/> moduły</span></div>
    </div>

    <div className="udf-stats">
      <article><small>Faktury kanoniczne</small><strong>{data.stats.canonicalInvoices}</strong><span>jeden rekord źródłowy</span></article>
      <article><small>Obserwacje źródeł</small><strong>{data.stats.sourceObservations}</strong><span>Wrzutnia · KSeF · ERP</span></article>
      <article><small>Wiele źródeł jednej FV</small><strong>{data.stats.multiSourceInvoices}</strong><span>połączone bez kopii</span></article>
      <article className={data.stats.openReviews ? "is-warning" : ""}><small>Do decyzji</small><strong>{data.stats.openReviews}</strong><span>{data.stats.projectAssignments} przypisań · {data.stats.duplicateReviews} duplikatów</span></article>
    </div>

    {message ? <p className="udf-message is-success">{message}</p> : null}
    {error ? <p className="udf-message is-error">{error}</p> : null}

    <article className="udf-panel">
      <div className="udf-panel__heading"><div><span>Administrator</span><h3>Do decyzji</h3></div><span>{data.reviews.length} otwartych</span></div>
      <div className="udf-review-list">
        {data.reviews.map((review) => <div className={`udf-review is-${review.type}`} key={review.id}>
          <div className="udf-review__main">
            <span className="udf-review__type"><AlertTriangle size={14}/>{reviewLabel(review)}{review.confidence > 0 ? ` · ${Math.round(review.confidence * 100)}%` : ""}</span>
            <strong>{review.invoiceNumber}</strong>
            <small>{review.direction === "sale" ? "Sprzedaż" : "Zakup"} · {money(review.grossAmount)}{review.sourceChannel ? ` · ${review.sourceChannel}` : ""}</small>
            <p>{review.description}</p>
          </div>
          <div className="udf-review__action">
            {review.type === "project_assignment" ? <>
              <label><span>Inwestycja</span><select value={projectByReview[review.id] ?? ""} onChange={(event) => setProjectByReview((current) => ({ ...current, [review.id]: event.target.value }))}><option value="">Wybierz inwestycję…</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              {review.suggestedProjectName ? <small>AI sugeruje: <b>{review.suggestedProjectName}</b></small> : null}
              <button className="primary-button" type="button" disabled={pending || !canWrite || !projectByReview[review.id]} onClick={() => act(review.id, "assign_project", projectByReview[review.id])}>{pending ? <LoaderCircle className="spin" size={14}/> : <Link2 size={14}/>}Przypisz</button>
            </> : review.type === "duplicate_candidate" ? <>
              <small>Podobna faktura: <b>{review.candidateInvoiceNumber ?? "istniejący dokument"}</b></small>
              <div className="udf-review__buttons"><button className="primary-button" type="button" disabled={pending || !canApprove} onClick={() => act(review.id, "duplicate_same")}>To ta sama faktura</button><button className="secondary-button" type="button" disabled={pending || !canApprove} onClick={() => act(review.id, "duplicate_distinct")}>To nowa faktura</button></div>
            </> : <button className="secondary-button" type="button" disabled={pending || !canApprove} onClick={() => act(review.id, "dismiss")}><CheckCircle2 size={14}/>Oznacz jako sprawdzone</button>}
          </div>
        </div>)}
        {!data.reviews.length ? <div className="udf-empty"><CheckCircle2 size={22}/><strong>Brak dokumentów wymagających decyzji</strong><span>Nowe faktury mogą być przetwarzane bez interwencji administratora.</span></div> : null}
      </div>
    </article>

    <article className="udf-panel">
      <div className="udf-panel__heading"><div><span>Kanoniczny rejestr</span><h3>Faktury i ich źródła</h3></div><button className="udf-refresh" type="button" onClick={() => router.refresh()}><RefreshCw size={14}/>Odśwież</button></div>
      <div className="udf-table-wrap"><table className="udf-table"><thead><tr><th>Faktura</th><th>Kontrahent</th><th>Źródła</th><th>Inwestycja</th><th>Brutto</th><th>Termin</th><th>Stan</th></tr></thead><tbody>
        {data.documents.map((document) => <tr key={document.id}><td><strong>{document.invoiceNumber}</strong><small>{document.direction === "sale" ? "Sprzedaż" : "Zakup"} · {date(document.issueDate)}</small></td><td>{document.counterparty}</td><td><div className="udf-badges">{document.sources.length ? document.sources.map((source) => <span key={source}>{source}</span>) : <span>Źródło historyczne</span>}</div></td><td>{document.projectNames.length ? document.projectNames.join(", ") : <em>Nieprzypisana</em>}</td><td>{money(document.grossAmount)}</td><td>{date(document.dueDate)}</td><td><span className={`udf-status is-${document.status}`}>{document.statusLabel}</span></td></tr>)}
        {!data.documents.length ? <tr><td colSpan={7}>Brak faktur w firmie.</td></tr> : null}
      </tbody></table></div>
    </article>
  </section>;
}
