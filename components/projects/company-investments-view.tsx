"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Building2, FileText, MapPin, Plus, Search, X } from "lucide-react";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import type { ProjectSummary } from "@/lib/types";

type CompanyInvestmentsViewProps = {
  workspaceId: string;
  projects: ProjectSummary[];
  canCreate: boolean;
};

export function CompanyInvestmentsView({ workspaceId, projects, canCreate }: CompanyInvestmentsViewProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("pl-PL");
  const filteredProjects = useMemo(() => {
    if (!normalized) return projects;
    return projects.filter((project) => [
      project.name,
      project.description,
      project.investor_name,
      project.location,
      project.status
    ].some((value) => String(value ?? "").toLocaleLowerCase("pl-PL").includes(normalized)));
  }, [normalized, projects]);

  return (
    <main className="co-page co-investments-page">
      <header className="co-page-heading co-investments-heading">
        <div>
          <p className="co-kicker">Inwestycje</p>
          <h1>Realizacje firmy</h1>
          <p>Otwórz inwestycję, znajdź ją po nazwie, inwestorze lub lokalizacji albo dodaj nową realizację.</p>
        </div>
        <div className="co-investments-heading__actions">
          <strong className="co-count-badge">{projects.length} inwestycji</strong>
          {canCreate ? (
            <button
              type="button"
              className="co-primary-button co-new-project-toggle"
              onClick={() => setShowCreateForm((value) => !value)}
              aria-expanded={showCreateForm}
              aria-controls="new-project-panel"
            >
              {showCreateForm ? <X size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
              {showCreateForm ? "Zamknij formularz" : "Nowa inwestycja"}
            </button>
          ) : null}
        </div>
      </header>

      {canCreate && showCreateForm ? (
        <section className="co-section co-section--form co-new-project-panel" id="new-project-panel" aria-labelledby="new-project-heading">
          <div className="co-section-heading">
            <div>
              <p className="co-kicker">Nowa realizacja</p>
              <h2 id="new-project-heading">Dodaj inwestycję</h2>
            </div>
          </div>
          <CreateProjectForm workspaceId={workspaceId} />
        </section>
      ) : null}

      <section className="co-section co-investment-portfolio" aria-labelledby="investment-list-heading">
        <div className="co-list-toolbar">
          <label className="co-list-search">
            <Search size={16} aria-hidden="true" />
            <span className="ux-sr-only">Szukaj inwestycji</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Szukaj inwestycji…"
              type="search"
              autoComplete="off"
            />
          </label>
          <small id="investment-list-heading" aria-live="polite">
            {normalized ? `${filteredProjects.length} z ${projects.length}` : `${projects.length} wszystkich`}
          </small>
        </div>

        {filteredProjects.length > 0 ? (
          <div className="co-investment-list" role="list">
            {filteredProjects.map((project) => (
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

                <Link href={`/workspace/projects/${project.id}`} className="co-investment-row__open" aria-label={`Otwórz inwestycję ${project.name}`}>
                  <FileText size={16} aria-hidden="true" />
                  Otwórz
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        ) : projects.length ? (
          <div className="co-empty-state">
            <strong>Brak inwestycji pasujących do wyszukiwania.</strong>
            <p>Zmień wpisaną frazę, aby zobaczyć pozostałe realizacje.</p>
            <button type="button" className="co-secondary-button" onClick={() => setQuery("")}>Wyczyść wyszukiwanie</button>
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
