import { AlertCircle, Brain, CheckCircle2, Cpu, FileQuestion, Sparkles } from "lucide-react";
import type { DocumentSummary } from "@/lib/types";

type BrainPanelProps = {
  status: {
    provider: string;
    geminiConfigured: boolean;
    ready: boolean;
  };
  compact?: boolean;
  reviewDocuments?: DocumentSummary[];
};

export function BrainPanel({ status, compact = false, reviewDocuments = [] }: BrainPanelProps) {
  return (
    <div className={compact ? "brain-panel brain-panel--compact" : "brain-panel brain-panel--workspace"}>
      <div className="brain-panel__header">
        <span className="brain-icon">
          <Brain size={24} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Octopus Brain</p>
          <h2>{compact ? "Analiza dokumentacji" : "Centrum wiedzy i weryfikacji"}</h2>
        </div>
      </div>

      <div className="brain-status-grid">
        <div>
          <Cpu size={18} aria-hidden="true" />
          <span>Dostawca AI</span>
          <strong>{status.provider}</strong>
        </div>
        <div>
          <Sparkles size={18} aria-hidden="true" />
          <span>Gemini</span>
          <strong>{status.geminiConfigured ? "gotowy" : "brak klucza"}</strong>
        </div>
        {!compact ? (
          <div>
            <FileQuestion size={18} aria-hidden="true" />
            <span>Do weryfikacji</span>
            <strong>{reviewDocuments.length}</strong>
          </div>
        ) : null}
      </div>

      {!compact ? (
        <section className="brain-review-queue">
          <div className="brain-review-queue__head">
            <div>
              <p className="eyebrow">Kolejka klasyfikacji</p>
              <h3>Pliki wymagające decyzji człowieka</h3>
            </div>
            <span>{reviewDocuments.length ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}{reviewDocuments.length ? `${reviewDocuments.length} do sprawdzenia` : "Kolejka czysta"}</span>
          </div>

          {reviewDocuments.length ? (
            <div className="brain-review-list">
              {reviewDocuments.slice(0, 8).map((document) => (
                <article key={document.id}>
                  <FileQuestion size={16} />
                  <span><strong>{document.name}</strong><small>Klasyfikacja: do weryfikacji</small></span>
                </article>
              ))}
            </div>
          ) : (
            <p>Nie ma plików oczekujących na ręczne przypisanie. Dokumenty o wystarczającej pewności zostały sklasyfikowane przez pipeline albo zachowały kategorię wybraną przez użytkownika.</p>
          )}
        </section>
      ) : null}

      <div className="brain-next-stage">
        <Sparkles size={18} />
        <p><strong>Aktywny pipeline:</strong> Wrzutnia → R2 → ekstrakcja PDF/Word/Excel → Gemini → klasyfikacja i fakty → źródła → Brain → moduły. Ręcznie wybrana kategoria ma pierwszeństwo; przy rozbieżności Brain tworzy ostrzeżenie zamiast nadpisywać decyzję użytkownika.</p>
      </div>
    </div>
  );
}
