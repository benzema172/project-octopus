"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Building2, FileText, MapPin, Plus, X } from "lucide-react";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import type { ProjectSummary } from "@/lib/types";

type CompanyInvestmentsViewProps = {
  workspaceId: string;
  projects: ProjectSummary[];
};

export function CompanyInvestmentsView({ workspaceId, projects }: CompanyInvestmentsViewProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);

  return (
    <main className="co-page co-investments-page">
      <header className="co-page-heading co-investments-heading">
        <div>
          <p className="co-kicker">Inwestycje</p>
          <h1>Realizacje firmy</h1>
          <p>Centralny punkt wejścia do dokumentacji, danych i obsługi każdej inwestycji.</p>
        </div>
        <div className="co-investments-heading__actions">
          <strong className="co-count-badge">{projects.length} inwestycji</strong>
          <button
            type="button"
            className="co-primary-button co-new-project-toggle"
            onClick={() => setShowCreateForm((value) => !value)}
            aria-expanded={showCreateForm}
            aria-controls="new-project-panel"
          >
            {showCreateForm ? <X size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
            {showCreateForm ? "Zamknij" : "Nowa inwestycja"}
          </button>
        </div>
      </header>

      {showCreateForm ? (
        <section className="co-section co-section--form co-new-project-panel" id="new-project-panel">
          <div className="co-section-heading">
            <div>
              <p className="co-kicker">Nowa realizacja</p>
              <h2>Dodaj inwestycję</h2>
            </div>
          </div>
          <CreateProjectForm workspaceId={workspaceId} />
        </section>
      ) : null}

      <section className="co-section co-investment-portfolio">
        <div className="co-section-heading co-investment-portfolio__heading">
          <div>
            <p className="co-kicker">Portfel realizacji</p>
            <h2>Wszystkie inwestycje</h2>
          </div>
        </div>

        {projects.length > 0 ? (
          <div className="co-investment-list" role="list">
            {projects.map((project) => (
              <article className="co-investment-row" key={project.id} role="listitem">
                <div className="co-investment-row__main">
                  <span className="co-investment-status">{project.status}</span>
                  <div>
                    <h3>{project.name}</h3>
                    <p>{project.description || "Workspace inwestycji gotowy na dokumentację i analizę."}</p>
                  </div>
                </div>

                <div className="co-investment-row__meta">
                  <div>
                    <Building2 size={15} aria-hidden="true" />
                    <span>
                      <small>Inwestor</small>
                      <strong>{project.investor_name || "Nie uzupełniono"}</strong>
                    </span>
                  </div>
                  <div>
                    <MapPin size={15} aria-hidden="true" />
                    <span>
                      <small>Lokalizacja</small>
                      <strong>{project.location || "Nie uzupełniono"}</strong>
                    </span>
                  </div>
                </div>

                <Link href={`/workspace/projects/${project.id}`} className="co-investment-row__open">
                  <FileText size={16} aria-hidden="true" />
                  Otwórz
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="co-empty-state">
            <strong>Pierwsza inwestycja czeka na utworzenie.</strong>
            <p>Po dodaniu otrzyma własną kartę, dokumentację i kontekst OctopusAI.</p>
          </div>
        )}
      </section>
    </main>
  );
}
