"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Building2, CircleAlert, FileText, ListChecks, MapPin, Plus, Search, X } from "lucide-react";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import type { ProjectTaskSignal } from "@/lib/investments/project-tasks";
import type { ProjectSummary } from "@/lib/types";

type CompanyInvestmentsViewProps = {
  workspaceId: string;
  projects: ProjectSummary[];
  taskSignals: Record<string, ProjectTaskSignal>;
  canCreate: boolean;
};

type PortfolioFilter = "all" | "attention" | "active" | "completed";

const STATUS_LABELS: Record<string, string> = {
  planned: "Planowana",
  tender: "Przetarg",
  active: "Aktywna",
  paused: "Wstrzymana",
  completed: "Zakończona",
  archived: "Archiwalna"
};

const FILTERS: Array<{ value: PortfolioFilter; label: string }> = [
  { value: "all", label: "Wszystkie" },
  { value: "attention", label: "Wymagają uwagi" },
  { value: "active", label: "Aktywne" },
  { value: "completed", label: "Zakończone" }
];

export function CompanyInvestmentsView({ workspaceId, projects, taskSignals, canCreate }: CompanyInvestmentsViewProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PortfolioFilter>("all");
  const normalized = query.trim().toLocaleLowerCase("pl-PL");
  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const signal = taskSignals[project.id];
      const needsAttention = Boolean(signal && (signal.overdueCount > 0 || signal.urgentCount > 0));
      if (filter === "attention" && !needsAttention) return false;
      if (filter === "active" && project.status !== "active") return false;
      if (filter === "completed" && !["completed", "archived"].includes(project.status)) return false;
      if (!normalized) return true;
      return [project.name, project.description, project.investor_name, project.location, project.status, signal?.nextTask?.title]
        .some((value) => String(value ?? "").toLocaleLowerCase("pl-PL").includes(normalized));
    }).sort((left, right) => {
      const leftSignal = taskSignals[left.id];
      const rightSignal = taskSignals[right.id];
      const leftScore = (leftSignal?.overdueCount ?? 0) * 100 + (leftSignal?.urgentCount ?? 0) * 10 + (left.status === "active" ? 1 : 0);
      const rightScore = (rightSignal?.overdueCount ?? 0) * 100 + (rightSignal?.urgentCount ?? 0) * 10 + (right.status === "active" ? 1 : 0);
      return rightScore - leftScore || left.name.localeCompare(right.name, "pl");
    });
  }, [filter, normalized, projects, taskSignals]);
  const activeCount = projects.filter((project) => project.status === "active").length;
  const attentionCount = projects.filter((project) => {
    const signal = taskSignals[project.id];
    return signal && (signal.overdueCount > 0 || signal.urgentCount > 0);
  }).length;
  const openTaskCount = Object.values(taskSignals).reduce((sum, signal) => sum + signal.openCount, 0);
  const overdueTaskCount = Object.values(taskSignals).reduce((sum, signal) => sum + signal.overdueCount, 0);

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
        <div className="co-portfolio-summary" aria-label="Stan portfela inwestycji">
          <div><small>Wszystkie</small><strong>{projects.length}</strong></div>
          <div><small>Aktywne</small><strong>{activeCount}</strong></div>
          <div data-tone={attentionCount ? "warning" : "calm"}><small>Wymagają uwagi</small><strong>{attentionCount}</strong></div>
          <div data-tone={overdueTaskCount ? "danger" : "calm"}><small>Działania otwarte</small><strong>{openTaskCount}</strong><span>{overdueTaskCount} po terminie</span></div>
        </div>
        <div className="co-list-toolbar">
          <div className="co-investment-filters" aria-label="Filtr portfela">
            {FILTERS.map((item) => <button type="button" key={item.value} className={filter === item.value ? "is-active" : undefined} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
          </div>
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
                  <div className="co-investment-row__state">
                    <span className="co-investment-status">{STATUS_LABELS[project.status] ?? project.status}</span>
                    {taskSignals[project.id]?.overdueCount ? <span className="co-investment-attention" data-tone="danger"><CircleAlert size={12} /> {taskSignals[project.id].overdueCount} po terminie</span> : taskSignals[project.id]?.urgentCount ? <span className="co-investment-attention" data-tone="warning"><CircleAlert size={12} /> {taskSignals[project.id].urgentCount} ważne</span> : taskSignals[project.id]?.openCount ? <span className="co-investment-attention"><ListChecks size={12} /> {taskSignals[project.id].openCount} działań</span> : null}
                  </div>
                  <div>
                    <h3>{project.name}</h3>
                    <p title={taskSignals[project.id]?.nextTask?.title ?? project.description ?? undefined}>{taskSignals[project.id]?.nextTask ? `Następne: ${taskSignals[project.id].nextTask?.title}` : project.description || "Workspace inwestycji gotowy na dokumentację i analizę."}</p>
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
            <strong>Brak inwestycji pasujących do widoku.</strong>
            <p>Zmień filtr lub wpisaną frazę, aby zobaczyć pozostałe realizacje.</p>
            <button type="button" className="co-secondary-button" onClick={() => { setQuery(""); setFilter("all"); }}>Wyczyść filtry</button>
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
