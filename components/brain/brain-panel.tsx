import { Brain, Cpu, Sparkles } from "lucide-react";

type BrainPanelProps = {
  status: {
    provider: string;
    geminiConfigured: boolean;
    ready: boolean;
  };
  compact?: boolean;
};

export function BrainPanel({ status, compact = false }: BrainPanelProps) {
  return (
    <div className={compact ? "brain-panel brain-panel--compact" : "brain-panel"}>
      <div className="brain-panel__header">
        <span className="brain-icon">
          <Brain size={24} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Octopus Brain</p>
          <h2>{compact ? "Analiza dokumentacji" : "Gotowość Gemini"}</h2>
        </div>
      </div>

      <div className="brain-status-grid">
        <div>
          <Cpu size={18} aria-hidden="true" />
          <span>Dostawca</span>
          <strong>{status.provider}</strong>
        </div>
        <div>
          <Sparkles size={18} aria-hidden="true" />
          <span>Klucz Gemini</span>
          <strong>{status.geminiConfigured ? "skonfigurowany" : "brak"}</strong>
        </div>
      </div>

      <p>
        MVP ma już miejsce na pipeline AI. Następny etap to ekstrakcja tekstu, chunkowanie, embeddingi i analiza dokumentacji z cytowaniem źródeł.
      </p>

      <button className="secondary-button" type="button" disabled>
        <Sparkles size={18} aria-hidden="true" />
        Analiza w następnym kroku
      </button>
    </div>
  );
}
