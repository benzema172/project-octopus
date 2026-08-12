import { AlertTriangle, Boxes, Brain, CheckCircle2, Cpu, FileSearch, Wrench } from "lucide-react";
import type { BrainKnowledge as BrainKnowledgeData, BrainSource } from "@/lib/data/brain-knowledge";

function SourceLine({ source }: { source: BrainSource | null }) {
  if (!source) return <small className="brain-knowledge-source">Źródło: dane systemowe / podsumowanie AI</small>;
  return (
    <small className="brain-knowledge-source">
      Źródło: {source.documentName}{source.pageNumber ? ` · str./ark. ${source.pageNumber}` : ""}{source.sectionLabel ? ` · ${source.sectionLabel}` : ""}
    </small>
  );
}

export function BrainKnowledge({ knowledge }: { knowledge: BrainKnowledgeData }) {
  const completedRuns = knowledge.runs.filter((run) => run.status === "completed").length;
  const failedRuns = knowledge.runs.filter((run) => run.status === "failed").length;

  return (
    <div className="brain-knowledge">
      <section className="brain-knowledge-metrics">
        <article><Brain size={18} /><span><small>Fakty</small><strong>{knowledge.facts.length}</strong></span></article>
        <article><Boxes size={18} /><span><small>Materiały</small><strong>{knowledge.materials.length}</strong></span></article>
        <article><Wrench size={18} /><span><small>Urządzenia</small><strong>{knowledge.devices.length}</strong></span></article>
        <article><Cpu size={18} /><span><small>Analizy zakończone</small><strong>{completedRuns}</strong></span></article>
      </section>

      <section className="brain-knowledge-grid">
        <div className="brain-knowledge-panel">
          <header><FileSearch size={18} /><div><p className="co-kicker">Wiedza inwestycji</p><h3>Fakty z dokumentów</h3></div></header>
          <div className="brain-knowledge-list">
            {knowledge.facts.length ? knowledge.facts.slice(0, 20).map((fact) => (
              <article key={fact.id}>
                <div><strong>{fact.fact_type.replaceAll("_", " ")}</strong><span>{fact.value_text || "—"}</span></div>
                <b>{typeof fact.confidence === "number" ? `${Math.round(fact.confidence * 100)}%` : "—"}</b>
                <SourceLine source={fact.source} />
                {fact.source?.quote ? <blockquote>{fact.source.quote}</blockquote> : null}
              </article>
            )) : <p className="brain-knowledge-empty">Brak faktów. Dodaj dokument przez Wrzutnię, aby uruchomić ekstrakcję i analizę.</p>}
          </div>
        </div>

        <div className="brain-knowledge-panel">
          <header><AlertTriangle size={18} /><div><p className="co-kicker">Kontrola</p><h3>Ustalenia i ryzyka</h3></div></header>
          <div className="brain-knowledge-list">
            {knowledge.findings.length ? knowledge.findings.slice(0, 16).map((finding) => (
              <article key={finding.id} className={`is-${finding.severity}`}>
                <div><strong>{finding.title}</strong><span>{finding.description || ""}</span></div>
                <SourceLine source={finding.source} />
                {finding.source?.quote ? <blockquote>{finding.source.quote}</blockquote> : null}
              </article>
            )) : <p className="brain-knowledge-empty">Brak aktywnych ustaleń z analizy dokumentacji.</p>}
          </div>
        </div>
      </section>

      <section className="brain-knowledge-grid">
        <div className="brain-knowledge-panel">
          <header><Boxes size={18} /><div><p className="co-kicker">Rozpoznane</p><h3>Materiały</h3></div></header>
          <div className="brain-knowledge-compact-list">
            {knowledge.materials.length ? knowledge.materials.slice(0, 18).map((item) => (
              <article key={item.id}>
                <CheckCircle2 size={14} />
                <span><strong>{item.name}</strong><small>{[item.installation, item.specification].filter(Boolean).join(" · ") || "bez dodatkowego opisu"}</small></span>
                <SourceLine source={item.source} />
              </article>
            )) : <p className="brain-knowledge-empty">Brak rozpoznanych materiałów.</p>}
          </div>
        </div>

        <div className="brain-knowledge-panel">
          <header><Wrench size={18} /><div><p className="co-kicker">Rozpoznane</p><h3>Urządzenia</h3></div></header>
          <div className="brain-knowledge-compact-list">
            {knowledge.devices.length ? knowledge.devices.slice(0, 18).map((item) => (
              <article key={item.id}>
                <CheckCircle2 size={14} />
                <span><strong>{item.name}</strong><small>{item.installation || "instalacja do ustalenia"}</small></span>
                <SourceLine source={item.source} />
              </article>
            )) : <p className="brain-knowledge-empty">Brak rozpoznanych urządzeń.</p>}
          </div>
        </div>
      </section>

      <section className="brain-runs">
        <div><p className="co-kicker">Historia pipeline</p><h3>Ostatnie analizy dokumentów</h3></div>
        <div className="brain-runs-list">
          {knowledge.runs.length ? knowledge.runs.slice(0, 10).map((run) => (
            <article key={run.id}>
              <span className={`brain-run-status is-${run.status}`}>{run.status}</span>
              <strong>{run.model || "Gemini"}</strong>
              <small>{new Date(run.created_at).toLocaleString("pl-PL")}</small>
              {run.error ? <p>{run.error}</p> : null}
            </article>
          )) : <p className="brain-knowledge-empty">Pipeline nie analizował jeszcze żadnego dokumentu.</p>}
        </div>
        {failedRuns ? <p className="brain-runs-warning">{failedRuns} analiz zakończyło się błędem — pliki pozostają bezpiecznie zapisane i można je przeanalizować ponownie.</p> : null}
      </section>
    </div>
  );
}
