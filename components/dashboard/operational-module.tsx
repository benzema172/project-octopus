import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Database, Sparkles, UploadCloud } from "lucide-react";
import type { WorkspaceModuleDefinition } from "@/lib/product/modules";

type OperationalModuleProps = {
  module: WorkspaceModuleDefinition;
  children?: React.ReactNode;
};

function statusClass(status: string) {
  if (status === "Aktywne") return "status-chip status-chip--positive";
  if (status === "Wymaga konfiguracji") return "status-chip status-chip--warning";
  return "status-chip";
}

export function OperationalModule({ module, children }: OperationalModuleProps) {
  return (
    <main className="workspace-page module-page">
      <section className="module-heading">
        <div>
          <p className="eyebrow">{module.eyebrow}</p>
          <h1>{module.title}</h1>
          <p>{module.description}</p>
        </div>
        <div className="module-heading__actions">
          <span className="status-pill"><CheckCircle2 size={15} aria-hidden="true" />{module.status}</span>
          <Link href="/workspace/documents?upload=1" className="primary-button">
            <UploadCloud size={17} aria-hidden="true" />
            Wrzutnia
          </Link>
        </div>
      </section>

      <section className="metric-grid" aria-label={`Wskaźniki: ${module.title}`}>
        {module.metrics.map((metric) => (
          <article key={metric.label} className={`metric-card metric-card--${metric.tone ?? "default"}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      <section className="module-insight-grid">
        <article className="module-panel">
          <div className="module-panel__heading">
            <AlertTriangle size={19} aria-hidden="true" />
            <div>
              <p className="eyebrow">Kontrola</p>
              <h2>Zasady i wyjątki</h2>
            </div>
          </div>
          <ul className="clean-list">
            {module.alerts.map((alert) => <li key={alert}>{alert}</li>)}
          </ul>
        </article>

        <article className="module-panel module-panel--ai">
          <div className="module-panel__heading">
            <Sparkles size={19} aria-hidden="true" />
            <div>
              <p className="eyebrow">Octopus Brain</p>
              <h2>Rola AI</h2>
            </div>
          </div>
          <p>{module.aiSummary}</p>
          <Link href="/workspace/brain" className="text-link">
            Przejdź do centrum analizy <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </article>
      </section>

      {children}

      <section className="section-band">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Zakres modułu</p>
            <h2>Funkcjonalności operacyjne</h2>
          </div>
          <span>{module.capabilities.length} obszary</span>
        </div>
        <div className="capability-grid">
          {module.capabilities.map((capability) => (
            <article key={capability.title} className="capability-card">
              <Database size={18} aria-hidden="true" />
              <h3>{capability.title}</h3>
              <p>{capability.description}</p>
              <small>Źródło: {capability.source}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="section-band">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Procesy</p>
            <h2>Przepływy do uruchomienia</h2>
          </div>
        </div>
        <div className="workflow-list">
          {module.workflows.map((workflow, index) => (
            <article key={workflow.label} className="workflow-row">
              <span className="workflow-row__number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{workflow.label}</h3>
                <p>{workflow.description}</p>
              </div>
              <span className={statusClass(workflow.status)}>{workflow.status}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
