"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Bookmark, FileSearch, LoaderCircle, Search, Trash2 } from "lucide-react";

type SearchResult = { entity_type: string; entity_id: string; domain: string; project_id: string | null; title: string; subtitle: string; score: number };
type SavedSearch = { id: string; name: string; query: string };

function href(workspaceId: string, row: SearchResult) {
  if (row.entity_type === "project" || row.entity_type === "boq_item") return row.project_id ? `/workspace/projects/${row.project_id}` : `/workspace/companies/${workspaceId}/investments`;
  if (row.entity_type === "document") return `/workspace/companies/${workspaceId}/documents`;
  if (row.entity_type === "invoice") return `/workspace/companies/${workspaceId}/finances`;
  if (row.entity_type === "employee") return `/workspace/companies/${workspaceId}/hr`;
  if (row.entity_type === "stock_item") return `/workspace/companies/${workspaceId}/warehouse`;
  if (row.entity_type === "vehicle") return `/workspace/companies/${workspaceId}/fleet`;
  return `/workspace/companies/${workspaceId}`;
}

const labels: Record<string, string> = { project: "Inwestycja", document: "Dokument", invoice: "Faktura", employee: "Pracownik", stock_item: "Magazyn", vehicle: "Pojazd", boq_item: "BOQ" };

function initialRecent(workspaceId: string) {
  if (typeof window === "undefined") return [] as string[];
  try {
    const parsed = JSON.parse(localStorage.getItem(`octopus-search:${workspaceId}`) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  } catch {
    return [] as string[];
  }
}

export function CompanySearch({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [recent, setRecent] = useState<string[]>(() => initialRecent(workspaceId));
  const [saveName, setSaveName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/company/saved-searches?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : { searches: [] })
      .then((payload: { searches?: SavedSearch[] }) => setSaved(payload.searches ?? []))
      .catch((fetchError: unknown) => {
        if (!(fetchError instanceof DOMException && fetchError.name === "AbortError")) setSaved([]);
      });
    return () => controller.abort();
  }, [workspaceId]);

  async function runSearch(value: string) {
    const normalized = value.trim();
    if (normalized.length < 2) return;
    setPending(true); setError(null); setQuery(normalized);
    try {
      const response = await fetch(`/api/company/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      const payload = await response.json() as { results?: SearchResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Wyszukiwanie nie powiodło się.");
      setResults(payload.results ?? []);
      setRecent((current) => {
        const next = [normalized, ...current.filter((item) => item !== normalized)].slice(0, 6);
        localStorage.setItem(`octopus-search:${workspaceId}`, JSON.stringify(next));
        return next;
      });
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Wyszukiwanie nie powiodło się.");
    } finally { setPending(false); }
  }

  async function submit(event: FormEvent) { event.preventDefault(); await runSearch(query); }

  async function saveCurrent() {
    const name = saveName.trim();
    if (!name || query.trim().length < 2) return;
    const response = await fetch("/api/company/saved-searches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, name, query: query.trim() }) });
    const payload = await response.json() as { search?: SavedSearch; error?: string };
    if (!response.ok || !payload.search) { setError(payload.error ?? "Nie udało się zapisać wyszukiwania."); return; }
    setSaved((current) => [payload.search!, ...current.filter((item) => item.id !== payload.search!.id && item.name !== payload.search!.name)]);
    setSaveName("");
  }

  async function removeSaved(id: string) {
    const response = await fetch("/api/company/saved-searches", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, id }) });
    if (response.ok) setSaved((current) => current.filter((item) => item.id !== id));
  }

  return <section className="co-section">
    <form onSubmit={submit} className="company-search-form">
      <Search size={19} aria-hidden="true" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nazwa, numer faktury, treść dokumentu, SKU, stanowisko, VIN, BOQ…" aria-label="Szukaj w firmie" />
      <button type="submit" disabled={pending || query.trim().length < 2}>{pending ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />} Szukaj</button>
    </form>

    {(saved.length || recent.length) ? <div className="co-category-strip" aria-label="Zapisane i ostatnie wyszukiwania">
      {saved.map((item) => <span key={item.id}><button type="button" onClick={() => void runSearch(item.query)}>{item.name}</button><button type="button" aria-label={`Usuń zapisane wyszukiwanie ${item.name}`} onClick={() => void removeSaved(item.id)}><Trash2 size={12} /></button></span>)}
      {recent.filter((item) => !saved.some((savedItem) => savedItem.query === item)).map((item) => <button type="button" key={item} onClick={() => void runSearch(item)}>{item}</button>)}
    </div> : null}

    {query.trim().length >= 2 ? <details className="ops-panel ops-disclosure"><summary className="ops-panel__summary"><div><p className="eyebrow">Skrót pracy</p><h2>Zapisz to wyszukiwanie</h2></div><Bookmark size={17} /></summary><div className="ops-panel__content"><div className="ops-inline-actions"><input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Np. faktury Wysoka, rury DN100" aria-label="Nazwa zapisanego wyszukiwania"/><button className="secondary-button" type="button" onClick={() => void saveCurrent()} disabled={!saveName.trim()}><Bookmark size={14}/> Zapisz</button></div></div></details> : null}

    {error ? <p className="form-error">{error}</p> : null}
    <div className="company-search-results">
      {results.map((row) => <Link key={`${row.entity_type}:${row.entity_id}`} href={href(workspaceId, row)}>
        <FileSearch size={18} />
        <div><small>{labels[row.entity_type] ?? row.entity_type} · {row.domain}</small><strong>{row.title}</strong><span>{row.subtitle}</span></div>
      </Link>)}
      {!pending && query.trim().length >= 2 && results.length === 0 && !error ? <p className="empty-copy">Brak wyników w modułach, do których masz dostęp.</p> : null}
    </div>
  </section>;
}
