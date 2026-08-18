"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { FileSearch, LoaderCircle, Search } from "lucide-react";

type SearchResult = { entity_type: string; entity_id: string; domain: string; project_id: string | null; title: string; subtitle: string; score: number };

function href(workspaceId: string, row: SearchResult) {
  if (["project", "boq_item"].includes(row.entity_type)) return row.project_id ? `/workspace/projects/${row.project_id}` : `/workspace/companies/${workspaceId}/investments`;
  if (row.entity_type === "knowledge") return row.project_id ? `/workspace/projects/${row.project_id}/knowledge` : `/workspace/companies/${workspaceId}/ai-center`;
  if (row.entity_type === "document") return `/workspace/companies/${workspaceId}/documents`;
  if (row.entity_type === "invoice") return `/workspace/companies/${workspaceId}/finances`;
  if (row.entity_type === "employee") return `/workspace/companies/${workspaceId}/hr`;
  if (row.entity_type === "stock_item") return `/workspace/companies/${workspaceId}/warehouse`;
  if (row.entity_type === "vehicle") return `/workspace/companies/${workspaceId}/fleet`;
  return `/workspace/companies/${workspaceId}`;
}

const labels: Record<string, string> = {
  project: "Inwestycja",
  document: "Dokument",
  invoice: "Faktura",
  employee: "Pracownik",
  stock_item: "Magazyn",
  vehicle: "Pojazd",
  boq_item: "BOQ",
  knowledge: "Wiedza firmy"
};

export function CompanySearch({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/company/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      const payload = await response.json() as { results?: SearchResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Wyszukiwanie nie powiodło się.");
      setResults(payload.results ?? []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Wyszukiwanie nie powiodło się.");
    } finally { setPending(false); }
  }

  return <section className="co-section">
    <form onSubmit={submit} className="company-search-form">
      <Search size={19} aria-hidden="true" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Inwestycja, dokument, faktura, pracownik, materiał, pojazd, BOQ lub wiedza firmy…" aria-label="Szukaj w firmie" />
      <button type="submit" disabled={pending || query.trim().length < 2}>{pending ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />} Szukaj</button>
    </form>
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
