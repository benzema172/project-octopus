import { AlertCircle, Brain, CheckCircle2, Cpu, FileQuestion, FileText, Layers3, PackageSearch, Sparkles, Wrench } from "lucide-react";
import type { ProjectKnowledgeSnapshot } from "@/lib/data/project-knowledge";
import type { DocumentSummary } from "@/lib/types";

type BrainPanelProps = {
  status: {
    provider: string;
    geminiConfigured: boolean;
    ready: boolean;
  };
  compact?: boolean;
  reviewDocuments?: DocumentSummary[];
  knowledge?: ProjectKnowledgeSnapshot;
};

export function BrainPanel({ status, compact = false, reviewDocuments = [], knowledge }: BrainPanelProps) {
  const snapshot = knowledge ?? {
    facts: 0,
    materials: 0,
    devices: 0,
    boqItems: 0,
    findings: 0,
    completedRuns: 0,
    failedRuns: 0,
    latestFacts: []
  };

  return (
    <div className={compact ? "brain-panel brain-panel--compact" : "brain-panel brain-panel--workspace"}>
      <div className="brain-panel__header">
        <span className="brain-icon"><Brain size={24} aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">Octopus Brain</p>
          <h2>{compact ? "Analiza dokumentacji" : "Wiedza inwestycji"}</h2>
        </div>
      </div>

      <div className="brain-status-grid">
        <div><Cpu size={18} /><span>Dostawca AI</span><strong>{status.provider}</strong></div>
        <div><Sparkles size={18} /><span>Gemini</span><strong>{status.geminiConfigured ? "gotowy" : "brak klucza"}</strong></div>
        {!compact ? <div><CheckCircle2 size={18} /><span>Analizy zakończone</span><strong>{snapshot.completedRuns}</strong></div> : null}
        {!compact ? <div><FileQuestion size={18} /><span>Do weryfikacji</span><strong>{reviewDocuments.length}</strong></div> : null}
      </div>

      {!compact ? (
        <>
          <section className="brain-knowledge-grid" aria-label="Rozpoznana wiedza">
            <article><FileText size={18} /><span><small>Fakty</small><strong>{snapshot.facts}</strong><b>dane kontraktowe i techniczne</b></span></article>
            <article><PackageSearch size={18} /><span><small>Materiały</small><strong>{snapshot.materials}</strong><b>rozpoznane w dokumentach</b></span></article>
            <article><Wrench size={18} /><span><small>Urządzenia</small><strong>{snapshot.devices}</strong><b>modele i parametry</b></span></article>
            <article><Layers3 size={18} /><span><small>Pozycje kosztorysu</small><strong>{snapshot.boqItems}</strong><b>BOQ / przedmiar</b></span></article>
          </section>

          <section className="brain-facts-panel">
            <div className="brain-review-queue__head">
              <div><p className="eyebrow">Pamięć inwestycji</p><h3>Ostatnio rozpoznane fakty</h3></div>
              <span>{snapshot.findings} ustaleń AI</span>
            </div>
            {snapshot.latestFacts.length ? (
              <div className="brain-fact-list">
                {snapshot.latestFacts.map((fact) => (
                  <article key={fact.id}>
                    <CheckCircle2 size={15} />
                    <span>
                      <small>{fact.factType.replaceAll("_", " ")}</small>
                      <strong>{fact.value}</strong>
                      {fact.quote ? <p>Źródło{fact.pageNumber ? ` · str. ${fact.pageNumber}` : ""}: „{fact.quote}”</p> : null}
                    </span>
                    {fact.confidence !== null ? <b>{Math.round(fact.confidence * 100)}%</b> : null}
                  </article>
                ))}
              </div>
            ) : <p>Brain nie ma jeszcze faktów. Wrzuć pierwszy PDF, DOCX, XLSX lub CSV przez Wrzutnię.</p>}
          </section>

          <section className="brain-review-queue">
            <div className="brain-review-queue__head">
              <div><p className="eyebrow">Kolejka klasyfikacji</p><h3>Dokumenty wymagające decyzji człowieka</h3></div>
              <span>{reviewDocuments.length ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}{reviewDocuments.length ? `${reviewDocuments.length} do sprawdzenia` : "Kolejka czysta"}</span>
            </div>
            {reviewDocuments.length ? (
              <div className="brain-review-list">
                {reviewDocuments.slice(0, 8).map((document) => <article key={document.id}><FileQuestion size={16} /><span><strong>{document.name}</strong><small>AI nie osiągnęło wystarczającej pewności klasyfikacji</small></span></article>)}
              </div>
            ) : <p>Nie ma plików oczekujących na ręczne przypisanie.</p>}
          </section>
        </>
      ) : null}

      <div className="brain-next-stage">
        <Sparkles size={18} />
        <p><strong>Pipeline aktywny:</strong> Wrzutnia → R2 → ekstrakcja Word/Excel/CSV lub natywne czytanie PDF → Gemini → klasyfikacja → fakty, materiały, urządzenia i BOQ → Brain → moduły. {snapshot.failedRuns ? `${snapshot.failedRuns} analiz zakończyło się błędem i wymaga ponowienia.` : ""}</p>
      </div>
    </div>
  );
}
