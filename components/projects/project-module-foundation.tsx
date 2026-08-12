import { CheckCircle2, FileText, Inbox, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DocumentSummary } from "@/lib/types";

type FoundationItem = {
  title: string;
  description: string;
  icon: LucideIcon;
};

type FoundationMetric = {
  label: string;
  value: string;
  hint: string;
};

type KnowledgeItem = {
  title: string;
  description: string;
  tag?: string;
};

type ProjectModuleFoundationProps = {
  kicker: string;
  title: string;
  description: string;
  status?: string;
  items: FoundationItem[];
  principle: string;
  metrics?: FoundationMetric[];
  documents?: DocumentSummary[];
  workflow?: string[];
  intakeLabel?: string;
  knowledge?: KnowledgeItem[];
  knowledgeTitle?: string;
};

export function ProjectModuleFoundation({
  kicker,
  title,
  description,
  status = "Gotowy do zasilenia",
  items,
  principle,
  metrics = [],
  documents = [],
  workflow = [
    "Wrzuć dokumenty przez Wrzutnię",
    "Octopus proponuje klasyfikację i powiązania",
    "Użytkownik zatwierdza ważne dane",
    "Moduł wykorzystuje zatwierdzoną wiedzę"
  ],
  intakeLabel = "Pliki przypisane do modułu",
  knowledge = [],
  knowledgeTitle = "Dane rozpoznane przez Brain"
}: ProjectModuleFoundationProps) {
  return (
    <div className="project-tab-content pw-module-page pw-module-page--operational">
      <section className="pw-module-intro">
        <div>
          <p className="co-kicker">{kicker}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span>{status}</span>
      </section>

      {metrics.length > 0 ? (
        <section className="pw-module-metrics" aria-label="Stan modułu">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <small>{metric.label}</small>
              <strong>{metric.value}</strong>
              <span>{metric.hint}</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="pw-module-workbench">
        <div className="pw-module-flow">
          <div className="pw-module-section-title">
            <span className="pw-card-icon"><Sparkles size={18} /></span>
            <div><p className="co-kicker">Przepływ pracy</p><h3>Jak pracuje ten moduł</h3></div>
          </div>
          <ol>
            {workflow.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
                {index < workflow.length - 1 ? <i /> : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="pw-module-inputs">
          <div className="pw-module-section-title">
            <span className="pw-card-icon"><Inbox size={18} /></span>
            <div><p className="co-kicker">Zasilanie</p><h3>{intakeLabel}</h3></div>
          </div>

          {documents.length > 0 ? (
            <div className="pw-module-document-list">
              {documents.slice(0, 5).map((document) => (
                <article key={document.id}>
                  <FileText size={16} />
                  <span>
                    <strong>{document.name}</strong>
                    <small>{document.category ?? "do weryfikacji"}</small>
                  </span>
                  <CheckCircle2 size={15} />
                </article>
              ))}
              {documents.length > 5 ? <p>+ {documents.length - 5} kolejnych plików przypisanych do tego modułu</p> : null}
            </div>
          ) : (
            <div className="pw-module-empty-input">
              <Inbox size={22} />
              <strong>Brak przypisanych plików</strong>
              <p>Użyj przycisku <b>WRZUTNIA</b> w górnym pasku. Octopus zaproponuje miejsce, a Ty możesz je zatwierdzić przed wysłaniem.</p>
            </div>
          )}
        </div>
      </section>

      {knowledge.length > 0 ? (
        <section className="pw-module-knowledge">
          <div className="pw-module-section-title">
            <span className="pw-card-icon"><Sparkles size={18} /></span>
            <div><p className="co-kicker">Brain → moduł</p><h3>{knowledgeTitle}</h3></div>
          </div>
          <div className="pw-module-knowledge-list">
            {knowledge.slice(0, 12).map((item, index) => (
              <article key={`${item.title}-${index}`}>
                <div><strong>{item.title}</strong><p>{item.description}</p></div>
                {item.tag ? <span>{item.tag}</span> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="pw-module-feature-grid">
        {items.map(({ title: itemTitle, description: itemDescription, icon: Icon }) => (
          <article key={itemTitle} className="pw-module-feature-card">
            <span className="pw-card-icon"><Icon size={20} aria-hidden="true" /></span>
            <h3>{itemTitle}</h3>
            <p>{itemDescription}</p>
          </article>
        ))}
      </section>

      <section className="pw-module-principle">
        <strong>Jak ten moduł łączy się z Octopusem</strong>
        <p>{principle}</p>
      </section>
    </div>
  );
}
