"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  FilePlus2,
  FileSearch,
  FileText,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud
} from "lucide-react";
import type { DocumentSummary, ProjectSummary } from "@/lib/types";
import { MAX_SUPPORTED_UPLOAD_BYTES, SUPPORTED_UPLOAD_ACCEPT, validateUploadFile } from "@/lib/r2/sanitize";

type DocumentUploadProps = {
  workspaceId?: string;
  projectId?: string;
  projects?: ProjectSummary[];
  documents: DocumentSummary[];
  trashedDocuments: DocumentSummary[];
  storageReady: boolean;
  defaultCategory?: string;
};

type UploadResponse = { uploadUrl: string; token: string; headers: Record<string, string> };
type DownloadResponse = { downloadUrl: string };
type CompleteResponse = { documentId: string; versionId: string; versionNumber: number };

const MAX_BROWSER_HASH_BYTES = 32 * 1024 * 1024;

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function categoryLabel(category: string | null) {
  const labels: Record<string, string> = {
    project: "Projekt",
    specification: "STWiOR",
    estimate: "Kosztorys",
    invoice: "Faktura",
    protocol: "Protokół",
    application: "Wniosek",
    template: "Wzór",
    hr: "Kadry",
    fleet: "Flota",
    pdf: "PDF",
    document: "Dokument",
    package: "Paczka",
    other: "Inne",
    kosztorys: "Kosztorys",
    dokument: "Dokument",
    paczka: "Paczka",
    inne: "Inne"
  };
  return category ? labels[category] ?? category : "Do klasyfikacji";
}

async function sha256ForSmallFile(file: File) {
  if (file.size > MAX_BROWSER_HASH_BYTES) return null;
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function DocumentUpload({ workspaceId, projectId, projects = [], documents, trashedDocuments, storageReady, defaultCategory = "" }: DocumentUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetDocumentIdRef = useRef<string | null>(null);
  const targetProjectIdRef = useRef<string | null>(projectId ?? null);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [uploadCategory, setUploadCategory] = useState(defaultCategory);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, startTransition] = useTransition();

  const categories = useMemo(
    () => Array.from(new Set(documents.map((document) => document.category).filter(Boolean))).sort() as string[],
    [documents]
  );
  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pl");
    return documents.filter((document) => {
      const matchesText = !normalized || document.name.toLocaleLowerCase("pl").includes(normalized) || (document.category ?? "").includes(normalized);
      return matchesText && (category === "all" || document.category === category);
    });
  }, [category, documents, query]);

  async function uploadFile(file: File, documentId: string | null, contextProjectId: string | null) {
    setError(null);
    const validationError = validateUploadFile(file.name, file.type || "application/octet-stream", file.size);
    if (validationError) throw new Error(validationError);
    setStatus(file.size <= MAX_BROWSER_HASH_BYTES ? "Obliczanie sumy kontrolnej" : `Przygotowywanie pliku (limit ${MAX_SUPPORTED_UPLOAD_BYTES / 1024 / 1024} MB)`);
    const digest = await sha256ForSmallFile(file);
    const mimeType = file.type || "application/octet-stream";
    const prepareResponse = await fetch("/api/storage/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, projectId: contextProjectId, documentId, fileName: file.name, mimeType, fileSize: file.size, category: uploadCategory || undefined })
    });
    if (!prepareResponse.ok) {
      const payload = await prepareResponse.json().catch(() => null);
      throw new Error(payload?.error ?? "Nie udało się wygenerować adresu uploadu.");
    }
    const upload = (await prepareResponse.json()) as UploadResponse;
    setStatus("Wysyłanie pliku do prywatnego R2");
    const putResponse = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: file });
    if (!putResponse.ok) throw new Error(`R2 odrzucił upload: HTTP ${putResponse.status}`);

    setStatus("Zapisywanie dokumentu i uruchamianie analizy AI");
    const completeResponse = await fetch("/api/storage/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: upload.token, sha256: digest, category: uploadCategory || undefined })
    });
    if (!completeResponse.ok) {
      const payload = await completeResponse.json().catch(() => null);
      throw new Error(payload?.error ?? "Nie udało się zapisać dokumentu.");
    }
    const completed = await completeResponse.json() as CompleteResponse;
    if (file.size <= 32 * 1024 * 1024) {
      setStatus("Dokument zapisany — Octopus Brain analizuje kontekst");
      const analysisResponse = await fetch("/api/brain/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, versionId: completed.versionId })
      });
      setStatus(analysisResponse.ok ? "Analiza AI gotowa do weryfikacji" : "Dokument zapisany — analiza pozostaje w kolejce");
    } else {
      setStatus("Dokument zapisany — duży plik oczekuje w kolejce workera");
    }
    startTransition(() => router.refresh());
  }

  async function handleFiles(files: FileList | null) {
    if (!storageReady) return;
    const file = files?.[0];
    if (!file) return;
    try {
      setIsUploading(true);
      await uploadFile(file, targetDocumentIdRef.current, targetProjectIdRef.current);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload nie powiódł się.");
      setStatus(null);
    } finally {
      setIsUploading(false);
      targetDocumentIdRef.current = null;
      targetProjectIdRef.current = projectId ?? (selectedProjectId || null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function openFilePicker(documentId: string | null = null, contextProjectId: string | null = selectedProjectId || null) {
    targetDocumentIdRef.current = documentId;
    targetProjectIdRef.current = projectId ?? contextProjectId;
    inputRef.current?.click();
  }

  async function downloadVersion(versionId: string, contextProjectId: string | null) {
    setError(null);
    setStatus("Przygotowywanie pobierania");
    try {
      const response = await fetch("/api/storage/download-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, projectId: contextProjectId, versionId })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Nie udało się przygotować pobierania.");
      }
      const payload = (await response.json()) as DownloadResponse;
      setStatus(null);
      window.location.assign(payload.downloadUrl);
    } catch (downloadError) {
      setStatus(null);
      setError(downloadError instanceof Error ? downloadError.message : "Pobieranie nie powiodło się.");
    }
  }

  async function analyzeVersion(versionId: string) {
    setError(null);
    setStatus("Octopus Brain analizuje dokument");
    try {
      const response = await fetch("/api/brain/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, versionId })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Nie udało się uruchomić analizy.");
      }
      setStatus("Analiza AI gotowa do weryfikacji");
      startTransition(() => router.refresh());
    } catch (analysisError) {
      setStatus("Dokument pozostaje w kolejce");
      setError(analysisError instanceof Error ? analysisError.message : "Analiza nie powiodła się.");
    }
  }

  async function changeDocumentState(documentId: string, state: "active" | "trashed", contextProjectId: string | null) {
    setError(null);
    setStatus(state === "trashed" ? "Przenoszenie dokumentu do kosza" : "Przywracanie dokumentu");
    try {
      const response = await fetch("/api/storage/document-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, projectId: contextProjectId, documentId, state })
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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj po nazwie, kategorii lub haśle" />
        </label>
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Kategoria dokumentu">
          <option value="all">Wszystkie kategorie</option>
          {categories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
        </select>
        <span className="document-toolbar__count">{filteredDocuments.length} / {documents.length}</span>
      </div>

      <div className="documents-layout">
        <div className="upload-panel">
          <input ref={inputRef} type="file" accept={SUPPORTED_UPLOAD_ACCEPT} onChange={(event) => handleFiles(event.target.files)} disabled={!storageReady} />
          {!projectId && projects.length > 0 ? (
            <label className="upload-context">
              <span>Kontekst dokumentu</span>
              <select value={selectedProjectId} onChange={(event) => {
                setSelectedProjectId(event.target.value);
                targetProjectIdRef.current = event.target.value || null;
              }}>
                <option value="">Dokument firmowy / AI dopasuje</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="upload-context">
            <span>Rodzaj źródła</span>
            <select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)}>
              <option value="">AI rozpozna automatycznie</option>
              <option value="project">Projekt / dokumentacja techniczna</option>
              <option value="specification">STWiOR / specyfikacja</option>
              <option value="estimate">Kosztorys</option>
              <option value="invoice">Faktura</option>
              <option value="protocol">Protokół</option>
              <option value="application">Wniosek materiałowy</option>
              <option value="template">Wzór i wiedza dla AI</option>
              <option value="hr">Dokument kadrowy</option>
              <option value="fleet">Dokument floty</option>
              <option value="other">Inny dokument</option>
            </select>
          </label>
          <button
            type="button"
            className={`upload-dropzone ${isDragging ? "upload-dropzone--active" : ""}`}
            onClick={() => openFilePicker()}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => { event.preventDefault(); setIsDragging(false); handleFiles(event.dataTransfer.files); }}
            disabled={isPending || isUploading || !storageReady}
          >
            <UploadCloud size={30} aria-hidden="true" />
            <strong>{isUploading ? "Przetwarzanie pliku" : "Przeciągnij plik lub wybierz z dysku"}</strong>
            <span>PDF, Word, Excel, obrazy, XML i ZIP · do {MAX_SUPPORTED_UPLOAD_BYTES / 1024 / 1024} MB</span>
          </button>
          <div className="upload-pipeline">
            <span>R2</span><span>Ekstrakcja</span><span>Gemini</span><span>Klasyfikacja</span><span>Moduły</span>
          </div>
          {!storageReady ? <p className="form-message">Uruchom wszystkie migracje do 20260814_domain_access_hardening, aby odblokować Wrzutnię.</p> : null}
          {status ? <p className="upload-status">{status}</p> : null}
          {error ? <p className="form-message form-message--error">{error}</p> : null}
        </div>

        <div className="document-list">
          {filteredDocuments.length > 0 ? filteredDocuments.map((document) => {
            const version = document.document_versions?.[0];
            const projectName = projects.find((item) => item.id === document.project_id)?.name;
            return (
              <article key={document.id} className="document-row">
                <FileText size={19} aria-hidden="true" />
                <div>
                  <div className="document-row__title">
                    <h3>{document.name}</h3>
                    <span className="document-category">{categoryLabel(document.category)}</span>
                  </div>
                  <p>{projectName ?? (document.project_id ? "Inwestycja" : "Dokument firmowy")} · {version?.mime_type ?? "plik"} · {version ? formatFileSize(version.file_size_bytes) : "bez wersji"} · {version ? `wersja ${version.version_number}` : "oczekuje"}</p>
                  <span className="document-ai-state"><Sparkles size={13} aria-hidden="true" />{["ready", "review"].includes(document.ai_status ?? "") ? "AI: analiza do weryfikacji" : "AI: w kolejce do analizy"}</span>
                </div>
                {version ? (
                  <div className="document-row__actions">
                    <button type="button" className="secondary-button" onClick={() => analyzeVersion(version.id)} disabled={isUploading}><Sparkles size={16} aria-hidden="true" />Analizuj</button>
                    <button type="button" className="secondary-button" onClick={() => downloadVersion(version.id, document.project_id)} disabled={isUploading}><Download size={16} aria-hidden="true" />Pobierz</button>
                    <button type="button" className="secondary-button" onClick={() => openFilePicker(document.id, document.project_id)} disabled={isUploading || !storageReady}><FilePlus2 size={16} aria-hidden="true" />Nowa wersja</button>
                    <button type="button" className="secondary-button secondary-button--danger" onClick={() => changeDocumentState(document.id, "trashed", document.project_id)} disabled={isUploading || isPending}><Trash2 size={16} aria-hidden="true" />Do kosza</button>
                  </div>
                ) : null}
              </article>
            );
          }) : (
            <div className="empty-state empty-state--compact"><FileSearch size={24} aria-hidden="true" /><h3>Brak pasujących dokumentów</h3><p>Wrzutnia przyjmie plik, zapisze jedną wersję źródłową i rozpocznie klasyfikację.</p></div>
          )}
        </div>
      </div>

      {trashedDocuments.length > 0 ? (
        <section className="trash-panel">
          <div><p className="eyebrow">Kosz</p><p>{trashedDocuments.length} dokumentów — pliki w R2 nie zostały usunięte.</p></div>
          <div className="document-list">
            {trashedDocuments.map((document) => (
              <article key={document.id} className="document-row document-row--trashed">
                <Trash2 size={18} aria-hidden="true" />
                <div><h3>{document.name}</h3><p>Przeniesiono do kosza</p></div>
                <div className="document-row__actions"><button type="button" className="secondary-button" onClick={() => changeDocumentState(document.id, "active", document.project_id)} disabled={isPending}><RotateCcw size={16} aria-hidden="true" />Przywróć</button></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
