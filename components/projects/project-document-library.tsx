"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, FileSearch, FileText, RotateCcw, Search, Sparkles, Trash2 } from "lucide-react";
import type { DocumentSummary } from "@/lib/types";
import { documentCategoryLabel } from "@/lib/documents/classification";

type Props = {
  workspaceId: string;
  projectId: string;
  documents: DocumentSummary[];
  trashedDocuments: DocumentSummary[];
};

type DownloadResponse = { downloadUrl: string };

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function aiState(document: DocumentSummary) {
  const status = document.ai_status ?? "queued";
  if (status === "ready") return "AI: uporządkowany i przypisany";
  if (status === "review") return "AI: kończy przypisania do modułów";
  if (status === "error") return "AI: analiza wymaga ponowienia";
  return "AI: analizuje i porządkuje";
}

export function ProjectDocumentLibrary({ workspaceId, projectId, documents, trashedDocuments }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categories = useMemo(
    () => Array.from(new Set(documents.map((document) => document.category).filter(Boolean))).sort() as string[],
    [documents]
  );
  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pl");
    return documents
      .filter((document) => {
        const matchesText = !normalized
          || document.name.toLocaleLowerCase("pl").includes(normalized)
          || (document.category ?? "").toLocaleLowerCase("pl").includes(normalized);
        return matchesText && (category === "all" || document.category === category);
      })
      .sort((a, b) => {
        const categoryCompare = documentCategoryLabel(a.category).localeCompare(documentCategoryLabel(b.category), "pl");
        if (categoryCompare !== 0) return categoryCompare;
        return a.name.localeCompare(b.name, "pl");
      });
  }, [category, documents, query]);

  async function getDownloadUrl(versionId: string) {
    const response = await fetch("/api/storage/download-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, projectId, versionId })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? "Nie udało się przygotować pliku.");
    }
    return (await response.json()) as DownloadResponse;
  }

  async function previewVersion(versionId: string) {
    setStatus("Przygotowywanie podglądu");
    setError(null);
    const previewWindow = window.open("about:blank", "_blank");
    if (previewWindow) previewWindow.opener = null;
    try {
      const payload = await getDownloadUrl(versionId);
      setStatus(null);
      if (previewWindow) previewWindow.location.replace(payload.downloadUrl);
      else window.open(payload.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (previewError) {
      previewWindow?.close();
      setStatus(null);
      setError(previewError instanceof Error ? previewError.message : "Podgląd nie powiódł się.");
    }
  }

  async function downloadVersion(versionId: string) {
    setStatus("Przygotowywanie pobierania");
    setError(null);
    try {
      const payload = await getDownloadUrl(versionId);
      setStatus(null);
      window.location.assign(payload.downloadUrl);
    } catch (downloadError) {
      setStatus(null);
      setError(downloadError instanceof Error ? downloadError.message : "Pobieranie nie powiodło się.");
    }
  }

  async function changeDocumentState(documentId: string, state: "active" | "trashed") {
    setStatus(state === "trashed" ? "Przenoszenie dokumentu do kosza" : "Przywracanie dokumentu");
    setError(null);
    try {
      const response = await fetch("/api/storage/document-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, projectId, documentId, state })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Nie udało się zmienić stanu dokumentu.");
      }
      setStatus(state === "trashed" ? "Dokument przeniesiony do kosza" : "Dokument przywrócony");
      startTransition(() => router.refresh());
    } catch (stateError) {
      setStatus(null);
      setError(stateError instanceof Error ? stateError.message : "Zmiana stanu dokumentu nie powiodła się.");
    }
  }

  return (
    <div className="documents-workspace">
      <div className="document-toolbar">
        <label className="document-search">
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj dokumentu po nazwie lub kategorii" />
        </label>
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Kategoria dokumentu">
          <option value="all">Wszystkie kategorie</option>
          {categories.map((item) => <option key={item} value={item}>{documentCategoryLabel(item)}</option>)}
        </select>
        <span className="document-toolbar__count">{filteredDocuments.length} / {documents.length}</span>
      </div>

      {status ? <p className="upload-status">{status}</p> : null}
      {error ? <p className="form-message form-message--error">{error}</p> : null}

      <div className="document-list">
        {filteredDocuments.length > 0 ? filteredDocuments.map((document) => {
          const version = document.document_versions?.[0];
          const quarantined = version?.malware_scan_status === "infected";
          return (
            <article key={document.id} id={`document-${document.id}`} className="document-row">
              <FileText size={19} aria-hidden="true" />
              <div>
                <div className="document-row__title">
                  <h3>{document.name}</h3>
                  <span className="document-category">{documentCategoryLabel(document.category)}</span>
                </div>
                <p>{version?.mime_type ?? "plik"} · {version ? formatFileSize(version.file_size_bytes) : "bez wersji"} · {version ? `wersja ${version.version_number}` : "oczekuje"}</p>
                <span className="document-ai-state"><Sparkles size={13} aria-hidden="true" />{aiState(document)}</span>
                {quarantined ? <span className="document-security-state">Kwarantanna · pobieranie zablokowane</span> : version?.malware_scan_status === "clean" ? <span className="document-security-state document-security-state--clean">Skan bezpieczeństwa: czysty</span> : null}
              </div>
              {version ? (
                <div className="document-row__actions">
                  <button type="button" className="secondary-button" onClick={() => previewVersion(version.id)} disabled={isPending || quarantined}><Eye size={16} aria-hidden="true" />Podgląd</button>
                  <button type="button" className="secondary-button" onClick={() => downloadVersion(version.id)} disabled={isPending || quarantined}><Download size={16} aria-hidden="true" />Pobierz</button>
                  <button type="button" className="secondary-button secondary-button--danger" onClick={() => changeDocumentState(document.id, "trashed")} disabled={isPending}><Trash2 size={16} aria-hidden="true" />Do kosza</button>
                </div>
              ) : null}
            </article>
          );
        }) : (
          <div className="empty-state empty-state--compact">
            <FileSearch size={24} aria-hidden="true" />
            <h3>Brak dokumentów</h3>
            <p>Pliki dodajesz wyłącznie przez Wrzutnię w nagłówku inwestycji. Octopus AI sam je nazwie, sklasyfikuje i przypisze.</p>
          </div>
        )}
      </div>

      {trashedDocuments.length > 0 ? (
        <section className="trash-panel">
          <div><p className="eyebrow">Kosz</p><p>{trashedDocuments.length} dokumentów</p></div>
          <div className="document-list">
            {trashedDocuments.map((document) => (
              <article key={document.id} className="document-row document-row--trashed">
                <Trash2 size={18} aria-hidden="true" />
                <div><h3>{document.name}</h3><p>Przeniesiono do kosza</p></div>
                <div className="document-row__actions">
                  <button type="button" className="secondary-button" onClick={() => changeDocumentState(document.id, "active")} disabled={isPending}><RotateCcw size={16} aria-hidden="true" />Przywróć</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
