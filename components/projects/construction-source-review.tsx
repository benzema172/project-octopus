"use client";

import { useState } from "react";
import { DocumentOpenLink } from "@/components/documents/document-open-link";
import type { Finding, ReviewKind } from "@/lib/documents/project-source-review";

const labels = { schedule: "Zadania z przedmiaru i warunki odbioru", materials: "Karty wyrobów i pozycje kosztorysu", protocols: "Pomiary, kryteria i uwagi do odcinków" };
type Item = Omit<Finding,"links"> & {links?: {label:string; href:string; versionId:string|null}[]};
export function ConstructionSourceReview({ workspaceId, projectId, kind }: { workspaceId: string; projectId: string; kind: ReviewKind }) {
  const [items,setItems] = useState<Item[] | null>(null);
  const [total,setTotal] = useState(0), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const open = (versionId:string) => <DocumentOpenLink {...{workspaceId,projectId,versionId}} fallbackHref={`/workspace/projects/${projectId}/documentation`} />;
  async function load() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({projectId,kind,offset:String(items?.length ?? 0)});
      const response = await fetch("/api/projects/construction-review?"+params,{cache:"no-store"});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Nie udało się odczytać źródeł.");
      setItems([...(items ?? []),...data.items]); setTotal(data.total);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Nie udało się odczytać źródeł."); }
    finally { setBusy(false); }
  }
  return <details className="pw-submodule-tool" onToggle={event => { if (event.currentTarget.open && items === null && !busy) void load(); }}>
    <summary>{labels[kind]} {items && `(${total})`}</summary>
    {busy && <p role="status">Odczytywanie źródeł…</p>}
    {error && <p role="alert">{error} <button onClick={load}>Ponów</button></p>}
    {items?.length === 0 && <p>Brak danych do porównania. Starsze pliki można ponownie przeanalizować we Wrzutni.</p>}
    {items && items.length > 0 && <ul>{items.map((item,i) => <li key={i}><strong>{item.title}</strong> · {item.status}
      {item.sources.map((s,j) => <div key={j}>{s.name} · {s.locator} {open(s.versionId)} {s.quote && <small>{s.quote}</small>}</div>)}
      {item.links?.map((link,j) => link.href ? <a key={j} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a> :
        <span key={j}>{link.label} {link.versionId ? open(link.versionId) : " · sprawdź załącznik w oryginale"}</span>)}
    </li>)}</ul>}
    {items && items.length < total && <button onClick={load} disabled={busy}>Pokaż kolejne</button>}
  </details>;
}
