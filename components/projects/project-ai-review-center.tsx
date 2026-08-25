"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, FileSearch, LoaderCircle, Pencil, ShieldCheck, X } from "lucide-react";
import { INVESTMENT_AI_MODULES, type InvestmentAiModule, type ProjectAiProposal, type ProjectAiProposalReview } from "@/lib/investments/ai-proposal-contract";

type Props = {
  projectId: string;
  review: ProjectAiProposalReview;
  canWrite: boolean;
  canApprove: boolean;
  compact?: boolean;
};

const MODULE_LABELS: Record<InvestmentAiModule, string> = {
  data: "Dane", documentation: "Dokumentacja", cost_estimate: "Kosztorys", schedule: "Harmonogram",
  tasks: "Zadania", site: "Budowa", progress: "Przeroby", requests: "Wnioski materiałowe",
  protocols: "Protokoły", finance: "Finanse", warehouse: "Magazyn", reports: "Raporty", closeout: "Zamknięcie"
};

const STATUS_LABELS: Record<string, string> = {
  proposed: "do decyzji", approved: "zatwierdzona", rejected: "odrzucona", publishing: "publikowanie",
  published: "opublikowana", failed: "błąd", superseded: "zastąpiona"
};

function scalar(value: unknown) {
  if (typeof value === "boolean") return value ? "tak" : "nie";
  if (typeof value === "number") return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 3 }).format(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string" || typeof entry === "number").slice(0, 4).join(", ");
  return "";
}

function locatorLabel(locator: Record<string, unknown>) {
  const parts = [
    typeof locator.page === "number" ? `str. ${locator.page}` : "",
    typeof locator.sheet === "string" ? `arkusz ${locator.sheet}` : "",
    typeof locator.row === "number" ? `wiersz ${locator.row}` : "",
    typeof locator.section === "string" ? locator.section : ""
  ].filter(Boolean);
  return parts.join(" · ") || "lokalizacja w źródle";
}

function ProposalRow({ item, selected, canWrite, canApprove, busy, onToggle, onAction, onEdit }: {
  item: ProjectAiProposal; selected: boolean; canWrite: boolean; canApprove: boolean; busy: boolean;
  onToggle: () => void; onAction: (action: "approve" | "reject") => void; onEdit: (title: string, module: InvestmentAiModule) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [module, setModule] = useState<InvestmentAiModule>(item.module);
  const pending = ["proposed", "approved", "failed"].includes(item.status);
  const payload = Object.entries(item.payload).filter(([, value]) => scalar(value)).slice(0, 8);
  return (
    <article className={`ai-proposal-row${selected ? " is-selected" : ""}`}>
      {pending && canApprove ? <input aria-label={`Wybierz ${item.title}`} type="checkbox" checked={selected} onChange={onToggle} /> : <span className="ai-proposal-row__marker" />}
      <button className="ai-proposal-row__main" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="ai-proposal-row__title">
          <strong>{item.title}</strong>
          <small>{item.documentName} · {locatorLabel(item.sourceLocator)}</small>
        </span>
        <span className="ai-proposal-row__badges">
          {item.requiresFormalApproval ? <b className="is-formal"><ShieldCheck size={11}/> formalna</b> : null}
          <b>{MODULE_LABELS[item.module]}</b>
          <b className={`is-status is-${item.status}`}>{STATUS_LABELS[item.status] ?? item.status}</b>
          {item.confidence !== null ? <b>{Math.round(item.confidence * 100)}%</b> : null}
          <ChevronDown size={14}/>
        </span>
      </button>
      {pending && (canApprove || canWrite) ? <span className="ai-proposal-row__actions">
        {canWrite ? <button type="button" title="Koryguj" onClick={() => setEditing((value) => !value)} disabled={busy}><Pencil size={13}/></button> : null}
        {canApprove ? <><button className="is-approve" type="button" title="Zatwierdź i opublikuj" onClick={() => onAction("approve")} disabled={busy}><Check size={14}/></button><button className="is-reject" type="button" title="Odrzuć" onClick={() => onAction("reject")} disabled={busy}><X size={14}/></button></> : null}
      </span> : null}
      {editing ? <form className="ai-proposal-row__edit" onSubmit={(event) => { event.preventDefault(); onEdit(title, module); setEditing(false); }}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} aria-label="Tytuł propozycji" />
        <select value={module} onChange={(event) => setModule(event.target.value as InvestmentAiModule)} aria-label="Moduł docelowy">
          {INVESTMENT_AI_MODULES.map((value) => <option key={value} value={value}>{MODULE_LABELS[value]}</option>)}
        </select>
        <button type="submit" disabled={busy || !title.trim()}>Zapisz korektę</button>
      </form> : null}
      {open ? <div className="ai-proposal-row__details">
        {item.sourceQuote ? <blockquote>„{item.sourceQuote}”</blockquote> : <p className="is-warning"><AlertTriangle size={12}/> Brak krótkiego cytatu — sprawdź dokument źródłowy.</p>}
        {payload.length ? <dl>{payload.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{scalar(value)}</dd></div>)}</dl> : null}
        {item.reviewNote ? <p>Notatka: {item.reviewNote}</p> : null}
      </div> : null}
    </article>
  );
}

export function ProjectAiReviewCenter({ projectId, review, canWrite, canApprove, compact = false }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<"pending" | "history">("pending");
  const [moduleFilter, setModuleFilter] = useState<InvestmentAiModule | "all">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = useMemo(() => review.items.filter((item) => {
    const isPending = ["proposed", "approved", "failed"].includes(item.status);
    return (filter === "pending" ? isPending : !isPending) && (moduleFilter === "all" || item.module === moduleFilter);
  }).slice(0, compact ? 12 : 500), [compact, filter, moduleFilter, review.items]);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/brain/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, ...body }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; succeeded?: number; failed?: number; autopilotWarning?: string | null };
      if (!response.ok) throw new Error(payload.error ?? "Nie udało się zapisać decyzji.");
      setSelected([]);
      setMessage(payload.succeeded !== undefined ? `Opublikowano lub rozstrzygnięto: ${payload.succeeded}${payload.failed ? ` · błędy: ${payload.failed}` : ""}.` : "Zapisano korektę.");
      if (payload.autopilotWarning) setError(`Decyzję zapisano, ale plan działań wymaga odświeżenia: ${payload.autopilotWarning}`);
      router.refresh();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Operacja nie powiodła się."); }
    finally { setBusy(false); }
  }

  function decide(ids: string[], action: "approve" | "reject") { if (ids.length) void post({ action, proposalIds: ids }); }
  return (
    <section id="ai-review-center" className={`ai-review-center${compact ? " ai-review-center--compact" : ""}`} aria-label="Centrum weryfikacji propozycji AI">
      <header className="ai-review-center__head">
        <span><FileSearch size={18}/><span><small>AI inwestycji</small><h2>Centrum weryfikacji</h2></span></span>
        <div className="ai-review-center__summary"><b>{review.pending}</b><span>do decyzji</span><b>{review.published}</b><span>opublikowane</span></div>
      </header>
      <div className="ai-review-center__toolbar">
        <div className="ai-review-center__tabs"><button className={filter === "pending" ? "is-active" : ""} onClick={() => setFilter("pending")} type="button">Do decyzji ({review.pending})</button><button className={filter === "history" ? "is-active" : ""} onClick={() => setFilter("history")} type="button">Historia</button></div>
        <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value as InvestmentAiModule | "all")} aria-label="Filtr modułu"><option value="all">Wszystkie moduły</option>{INVESTMENT_AI_MODULES.map((value) => <option key={value} value={value}>{MODULE_LABELS[value]} {review.byModule[value] ? `(${review.byModule[value]})` : ""}</option>)}</select>
        {canApprove && filter === "pending" ? <div className="ai-review-center__bulk"><button disabled={busy || !selected.length} onClick={() => decide(selected, "approve")} type="button"><Check size={13}/> Zatwierdź ({selected.length})</button><button disabled={busy || !selected.length} onClick={() => decide(selected, "reject")} type="button"><X size={13}/> Odrzuć</button></div> : null}
      </div>
      {message ? <p className="ai-review-center__message is-success">{message}</p> : null}{error ? <p className="ai-review-center__message is-error">{error}</p> : null}
      {busy ? <p className="ai-review-center__busy"><LoaderCircle className="spin" size={14}/> Trwa bezpieczna publikacja…</p> : null}
      <div className="ai-review-center__list">
        {visible.map((item) => <ProposalRow key={item.id} item={item} selected={selected.includes(item.id)} canWrite={canWrite} canApprove={canApprove} busy={busy}
          onToggle={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
          onAction={(action) => decide([item.id], action)} onEdit={(title, module) => void post({ action: "update", proposalId: item.id, title, module })}/>) }
        {!visible.length ? <p className="ai-review-center__empty"><ShieldCheck size={16}/> {filter === "pending" ? "Brak propozycji wymagających decyzji." : "Brak rozstrzygniętych propozycji w tym filtrze."}</p> : null}
      </div>
    </section>
  );
}
