"use client";

import { FormEvent, useState } from "react";
import { BookOpenCheck, FileText, LoaderCircle, Search, Sparkles } from "lucide-react";

type SearchResult = {
  source_type: string;
  source_id: string;
  project_id: string | null;
  title: string;
  context: string;
  category: string;
  source_locator: Record<string, unknown>;
  score: number;
};

type KnowledgeSearchProps = {
  projectId?: string;
  workspaceId?: string;
  suggestions?: string[];
};

export function KnowledgeSearch({ projectId, workspaceId, suggestions = [] }: KnowledgeSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (projectId) params.set("projectId", projectId);
      if (workspaceId) params.set("workspaceId", workspaceId);
      const response = await fetch(`/api/brain/search?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as { results?: SearchResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Wyszukiwanie nie powiodło się.");
      setResults(payload.results ?? []);
      setSearched(true);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Wyszukiwanie nie powiodło się.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="knowledge-search">
      {suggestions.length ? (
        <div className="knowledge-search__suggestions" aria-label="Szybkie pytania">
          {suggestions.slice(0, 6).map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setQuery(suggestion)}>{suggestion}</button>
          ))}
        </div>
      ) : null}
      <form onSubmit={submit} className="knowledge-search__form">
        <Search size={20} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={projectId ? "Szukaj w dokumentach i Project DNA tej inwestycji…" : "Szukaj w dokumentach, faktach i wiedzy firmy…"}
          aria-label="Wyszukiwarka wiedzy"
        />
        <button type="submit" className="primary-button" disabled={loading || query.trim().length < 2}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
          Szukaj
        </button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
      {searched ? (
        <div className="knowledge-search__results">
          <div className="section-heading">
            <div><p className="eyebrow">Wyniki ze źródłami</p><h3>{results.length ? `${results.length} trafień` : "Brak trafień"}</h3></div>
          </div>
          {results.map((result) => (
            <article key={`${result.source_type}-${result.source_id}`} className="search-result-card">
              <span className="search-result-card__icon">{result.source_type === "document" ? <FileText size={18} /> : <BookOpenCheck size={18} />}</span>
              <div>
                <div className="search-result-card__meta"><span>{result.source_type}</span><span>{result.category}</span><span>{Math.round(result.score * 100)} pkt</span></div>
                <h3>{result.title}</h3>
                <p>{result.context || "Rekord ma źródło, ale nie ma jeszcze tekstu do podglądu."}</p>
                <small>Identyfikator źródła: {result.source_id}</small>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
