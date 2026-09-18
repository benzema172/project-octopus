"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bot, CheckCircle2, Gauge, GitMerge, Link2, LoaderCircle, MessageSquareText, RefreshCw, ShieldCheck, Sparkles, Split, UploadCloud, Zap } from "lucide-react";
import type { UnifiedDocumentFlowData, UnifiedDocumentReview } from "@/lib/data/unified-document-flow";
import type { UnifiedAiPolicyMode, UnifiedAiRecommendation } from "@/lib/types/unified-document-ai";

function money(value: number) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(value || 0);
}
function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("pl-PL");
}
function reviewLabel(review: UnifiedDocumentReview) {
  if (review.kind === "invoice_quality") return "Kontrola jakości odczytu";
  if (review.type === "duplicate_candidate") return "Możliwy duplikat";
  if (review.type === "source_conflict") return "Konflikt źródeł";
  return "Do przypisania";
}
function recommendationLabel(value: UnifiedAiRecommendation) {
  if (value === "duplicate_same") return "Połącz jako tę samą fakturę";
  if (value === "duplicate_distinct") return "Pozostaw jako osobne faktury";
  if (value === "assign_project") return "Przypisz do inwestycji";
  if (value === "dismiss") return "Zamknij konflikt";
  return "Wymaga decyzji człowieka";
}
function policyLabel(value: UnifiedAiPolicyMode) {
  return value === "advisory" ? "Doradczy" : value === "autopilot" ? "Autopilot" : "Chroniony";
}

type AiAction = "analyze_review" | "analyze_queue" | "ask" | "apply_ai" | "set_policy";

export function UnifiedDocumentFlow({ workspaceId, data, canWrite, canApprove }: { workspaceId: string; data: UnifiedDocumentFlowData; canWrite: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
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

  const aiCall = (action: AiAction, payload: Record<string, unknown> = {}, busyKey: string = action) => {
    setMessage(null); setError(null); setAiBusy(busyKey);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/unified-document-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, action, ...payload }) });
        const result = await response.json().catch(() => ({})) as { error?: string; answer?: string; analyzed?: number; remaining?: number; autopilot?: { applied?: boolean; reason?: string } };
        if (!response.ok) throw new Error(result.error ?? "Octopus AI nie wykonał operacji.");
        if (action === "ask") {
          setAiAnswer(result.answer ?? "Brak odpowiedzi AI.");
        } else if (action === "analyze_queue") {
          setMessage(`Octopus AI przeanalizował ${result.analyzed ?? 0} decyzji${typeof result.remaining === "number" ? `. Pozostało: ${result.remaining}.` : "."}`);
          router.refresh();
        } else if (action === "analyze_review") {
          setMessage(result.autopilot?.applied ? "Analiza AI zakończona. Autopilot bezpiecznie wykonał rekomendowaną decyzję." : `Analiza AI gotowa.${result.autopilot?.reason ? ` ${result.autopilot.reason}` : ""}`);
          router.refresh();
        } else if (action === "apply_ai") {
          setMessage("Rekomendacja Octopus AI została zatwierdzona i zastosowana w kanonicznym obiegu dokumentu.");
          router.refresh();
        } else {
          setMessage("Polityka Octopus AI została zaktualizowana.");
          router.refresh();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Operacja Octopus AI nie powiodła się.");
      } finally {
        setAiBusy(null);
      }
    });
  };

  const changeMode = (mode: UnifiedAiPolicyMode) => aiCall("set_policy", { policy: { mode } }, "policy");

  return <section className="udf-shell" aria-label="Unified Document and Finance Flow">
    <div className="udf-heading">
      <div><span>Unified Document & Finance Flow</span><h2>Jedna faktura · wiele źródeł · jedna prawda</h2><p>Wrzutnia, KSeF i kolejne integracje trafiają do jednego dokumentu kanonicznego. Octopus rozdziela jego skutki do Finansów, Magazynu i właściwej inwestycji bez tworzenia kopii.</p></div>
      <div className="udf-flow"><span><UploadCloud size={15}/> Wrzutnia / KSeF</span><b>→</b><span><ShieldCheck size={15}/> kontrola AI</span><b>→</b><span><GitMerge size={15}/> faktura kanoniczna</span><b>→</b><span><Split size={15}/> moduły</span></div>
    </div>

    <div className="udf-ai-command">
      <div className="udf-ai-command__intro"><span><Bot size={16}/> Octopus AI Decision Engine</span><strong>AI analizuje dowody, ryzyko i właściwy następny krok</strong><p>Model korzysta z danych faktury, pozycji, źródeł, kontrahenta i katalogu inwestycji. Decyzje finansowe pozostają audytowalne; Autopilot działa tylko w granicach ustawionej polityki.</p></div>
      <div className="udf-ai-command__actions">
        <label><span>Tryb AI</span><select value={data.aiPolicy.mode} disabled={!canApprove || aiBusy === "policy"} onChange={(event) => changeMode(event.target.value as UnifiedAiPolicyMode)}><option value="advisory">Doradczy</option><option value="guarded">Chroniony</option><option value="autopilot">Autopilot</option></select></label>
        <button className="primary-button" type="button" disabled={!canWrite || pending || data.stats.openReviews === 0 || aiBusy === "queue"} onClick={() => aiCall("analyze_queue", {}, "queue")}>{aiBusy === "queue" ? <LoaderCircle className="spin" size={14}/> : <Sparkles size={14}/>}Przeanalizuj kolejkę AI</button>
      </div>
      <div className="udf-ai-kpis">
        <span><b>{data.stats.aiAnalyzedOpen}/{data.stats.openReviews}</b> przeanalizowanych</span>
        <span className={data.stats.aiHighConfidence ? "is-good" : ""}><b>{data.stats.aiHighConfidence}</b> wysokiej pewności</span>
        <span className={data.stats.aiHighRisk ? "is-risk" : ""}><b>{data.stats.aiHighRisk}</b> wysokiego ryzyka</span>
        <span className={data.stats.valueAtRisk ? "is-risk" : ""}><b>{money(data.stats.valueAtRisk)}</b> wartości wymagającej uwagi</span>
        <span><b>{policyLabel(data.aiPolicy.mode)}</b> aktualna polityka</span>
      </div>
      <div className="udf-ai-ask"><MessageSquareText size={16}/><input value={aiQuestion} onChange={(event) => setAiQuestion(event.target.value)} placeholder="Zapytaj AI, np. które dokumenty wymagają dziś mojej uwagi i dlaczego?" onKeyDown={(event) => { if (event.key === "Enter" && aiQuestion.trim()) aiCall("ask", { question: aiQuestion }, "ask"); }}/><button className="secondary-button" type="button" disabled={!aiQuestion.trim() || aiBusy === "ask"} onClick={() => aiCall("ask", { question: aiQuestion }, "ask")}>{aiBusy === "ask" ? <LoaderCircle className="spin" size={14}/> : <Bot size={14}/>}Zapytaj</button></div>
      {aiAnswer ? <div className="udf-ai-answer"><strong>Octopus AI</strong><p>{aiAnswer}</p></div> : null}
    </div>

    <div className="udf-stats">
      <article><small>Faktury kanoniczne</small><strong>{data.stats.canonicalInvoices}</strong><span>jeden rekord źródłowy</span></article>
      <article><small>Obserwacje źródeł</small><strong>{data.stats.sourceObservations}</strong><span>Wrzutnia · KSeF · ERP</span></article>
      <article><small>Wiele źródeł jednej FV</small><strong>{data.stats.multiSourceInvoices}</strong><span>połączone bez kopii</span></article>
      <article className={data.stats.openReviews ? "is-warning" : ""}><small>Do decyzji</small><strong>{data.stats.openReviews}</strong><span>{data.stats.projectAssignments} przypisań · {data.stats.duplicateReviews} duplikatów · {data.stats.qualityReviews} jakości</span></article>
    </div>

    {message ? <p className="udf-message is-success">{message}</p> : null}
    {error ? <p className="udf-message is-error">{error}</p> : null}

    <article className="udf-panel">
      <div className="udf-panel__heading"><div><span>AI + Administrator</span><h3>Centrum decyzji</h3></div><span>{data.reviews.length} otwartych · sortowanie wg ryzyka</span></div>
      <div className="udf-review-list">
        {data.reviews.map((review) => <div className={`udf-review is-${review.type}${(review.aiInsight?.riskScore ?? 0) >= .6 ? " is-high-risk" : ""}`} key={review.id}>
          <div className="udf-review__main">
            <span className="udf-review__type"><AlertTriangle size={14}/>{reviewLabel(review)}{review.kind === "invoice_quality" && review.qualityScore !== null ? ` · jakość ${Math.round(review.qualityScore * 100)}%` : review.confidence > 0 ? ` · reguły ${Math.round(review.confidence * 100)}%` : ""}</span>
            <strong>{review.invoiceNumber}</strong>
            <small>{review.direction === "sale" ? "Sprzedaż" : "Zakup"} · {money(review.grossAmount)}{review.sourceChannel ? ` · ${review.sourceChannel}` : ""}</small>
            <p>{review.description}</p>
            {review.kind === "invoice_quality" && (review.qualityIssues.length || review.qualityWarnings.length) ? <div className="udf-ai-alert">
              {[...review.qualityIssues, ...review.qualityWarnings].slice(0, 4).join(" · ")}
            </div> : null}
            {review.aiInsight ? <div className="udf-ai-insight">
              <div className="udf-ai-insight__top"><span><Bot size={14}/> {review.aiInsight.model.startsWith("octopus-consensus[") ? "AI Council 4/4" : review.aiInsight.mode === "gemini" ? "Gemini" : "Silnik reguł"}</span><b>{recommendationLabel(review.aiInsight.recommendation)}</b><em className={review.aiInsight.riskScore >= .6 ? "is-risk" : review.aiInsight.riskScore < .35 ? "is-good" : ""}><Gauge size={13}/> pewność {Math.round(review.aiInsight.confidence * 100)}% · ryzyko {Math.round(review.aiInsight.riskScore * 100)}%</em></div>
              <p>{review.aiInsight.summary}</p>
              {review.aiInsight.nextBestAction ? <small><Zap size={12}/> Następny krok: {review.aiInsight.nextBestAction}</small> : null}
              {review.aiInsight.reasons.length ? <ul>{review.aiInsight.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
              {review.aiInsight.anomalies.length ? <div className="udf-ai-alert">{review.aiInsight.anomalies.slice(0, 2).join(" · ")}</div> : null}
            </div> : <div className="udf-ai-missing"><Bot size={14}/><span>Brak analizy AI tej decyzji.</span></div>}
          </div>
          <div className="udf-review__action">
            <button className="udf-ai-review-button" type="button" disabled={!canWrite || pending || aiBusy === review.id} onClick={() => aiCall("analyze_review", { reviewId: review.id }, review.id)}>{aiBusy === review.id ? <LoaderCircle className="spin" size={14}/> : <Sparkles size={14}/>} {review.aiInsight ? "Analizuj ponownie" : "Analizuj AI"}</button>
            {review.aiInsight && review.aiInsight.recommendation !== "manual_review" ? <button className="primary-button" type="button" disabled={!canApprove || pending || aiBusy === `apply-${review.id}`} onClick={() => aiCall("apply_ai", { reviewId: review.id, insightId: review.aiInsight?.id }, `apply-${review.id}`)}><Zap size={14}/>Zastosuj rekomendację AI</button> : null}
            {review.type === "project_assignment" ? <>
              <label><span>Inwestycja — decyzja ręczna</span><select value={projectByReview[review.id] ?? ""} onChange={(event) => setProjectByReview((current) => ({ ...current, [review.id]: event.target.value }))}><option value="">Wybierz inwestycję…</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              {review.aiInsight?.recommendedProjectName ? <small>AI wskazuje: <b>{review.aiInsight.recommendedProjectName}</b></small> : review.suggestedProjectName ? <small>Reguły wskazują: <b>{review.suggestedProjectName}</b></small> : null}
              <button className="secondary-button" type="button" disabled={pending || !canWrite || !projectByReview[review.id]} onClick={() => act(review.id, "assign_project", projectByReview[review.id])}><Link2 size={14}/>Przypisz ręcznie</button>
            </> : review.type === "duplicate_candidate" ? <>
              <small>Podobna faktura: <b>{review.candidateInvoiceNumber ?? "istniejący dokument"}</b></small>
              <div className="udf-review__buttons"><button className="secondary-button" type="button" disabled={pending || !canApprove} onClick={() => act(review.id, "duplicate_same")}>Ta sama faktura</button><button className="secondary-button" type="button" disabled={pending || !canApprove} onClick={() => act(review.id, "duplicate_distinct")}>Osobna faktura</button></div>
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
