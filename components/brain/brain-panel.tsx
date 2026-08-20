import { AlertCircle, Brain, CheckCircle2, Cpu, FileQuestion, Sparkles } from "lucide-react";
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

  if (compact) {
    return (
      <div className="brain-panel brain-panel--compact">
        <div className="brain-panel__header">
          <span className="brain-icon"><Brain size={24} aria-hidden="true" /></span>
          <div>
            <p className="eyebrow">Octopus Brain</p>
            <h2>Analiza dokumentacji</h2>
          </div>
        </div>
        <div className="brain-status-grid">
          <div><Cpu size={18} /><span>Dostawca AI</span><strong>{status.provider}</strong></div>
          <div><Sparkles size={18} /><span>Gemini</span><strong>{status.geminiConfigured ? "gotowy" : "brak klucza"}</strong></div>
        </div>
      </div>
    );
  }

  const totalKnowledge = snapshot.facts + snapshot.materials + snapshot.devices + snapshot.boqItems;

  return (
    <div className="brain-panel brain-panel--workspace brain-workspace">
      <header className="brain-workspace__hero">
        <span className="brain-icon"><Brain size={23} aria-hidden="true" /></span>
        <div className="brain-workspace__intro">
          <p className="eyebrow">Octopus Brain</p>
          <h2>Wiedza inwestycji</h2>
          <p>Jedna pamięć inwestycji zasilana dokumentacją. Brain przechowuje rozpoznane fakty i źródła, a następnie przekazuje je do Karty inwestycji i pozostałych modułów.</p>
        </div>
        <div className="brain-workspace__status" aria-label="Stan wiedzy inwestycji">
          <strong>{totalKnowledge}</strong>
          <span>rozpoznanych elementów</span>
          {reviewDocuments.length ? <b className="is-warning"><AlertCircle size={13} /> {reviewDocuments.length} do decyzji</b> : <b><CheckCircle2 size={13} /> bez zaległej weryfikacji</b>}
        </div>
      </header>

      <div className="brain-knowledge-inline" aria-label="Zakres pamięci Brain">
        <span><b>{snapshot.facts}</b> faktów</span>
        <span><b>{snapshot.materials}</b> materiałów</span>
        <span><b>{snapshot.devices}</b> urządzeń</span>
        <span><b>{snapshot.boqItems}</b> pozycji BOQ</span>
        {snapshot.failedRuns ? <span className="is-warning"><b>{snapshot.failedRuns}</b> analiz do ponowienia</span> : null}
      </div>

      <div className="brain-workspace__content">
        <section className="brain-facts-panel brain-facts-panel--compact">
          <div className="brain-review-queue__head">
            <div><p className="eyebrow">Pamięć inwestycji</p><h3>Ostatnio rozpoznane</h3></div>
            <span>{snapshot.findings} ustaleń AI</span>
          </div>
          {snapshot.latestFacts.length ? (
            <div className="brain-fact-list">
              {snapshot.latestFacts.slice(0, 6).map((fact) => (
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
          ) : (
            <div className="brain-empty-state">
              <Brain size={18} />
              <span><strong>Brain jest jeszcze pusty.</strong><small>Wrzuć dokumentację przez Wrzutnię. Octopus zacznie budować pamięć inwestycji automatycznie.</small></span>
            </div>
          )}
        </section>

        <section className="brain-review-queue brain-review-queue--compact">
          <div className="brain-review-queue__head">
            <div><p className="eyebrow">Twoja decyzja</p><h3>Do weryfikacji</h3></div>
            <span>{reviewDocuments.length || 0}</span>
          </div>
          {reviewDocuments.length ? (
            <div className="brain-review-list">
              {reviewDocuments.slice(0, 5).map((document) => (
                <article key={document.id}>
                  <FileQuestion size={16} />
                  <span><strong>{document.name}</strong><small>AI potrzebuje potwierdzenia klasyfikacji lub przypisania.</small></span>
                </article>
              ))}
            </div>
          ) : (
            <div className="brain-review-clear"><CheckCircle2 size={17} /><span><strong>Nic nie wymaga decyzji.</strong><small>Dokumenty zostały przypisane bez potrzeby ręcznej interwencji.</small></span></div>
          )}
        </section>
      </div>
    </div>
  );
}
