"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FilePlus2, FileText, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import type { DocumentSummary } from "@/lib/types";

type DocumentUploadProps = {
  projectId: string;
  documents: DocumentSummary[];
  trashedDocuments: DocumentSummary[];
  storageReady: boolean;
};

type UploadResponse = {
  uploadUrl: string;
  token: string;
  headers: Record<string, string>;
};

type DownloadResponse = {
  downloadUrl: string;
};

const MAX_BROWSER_HASH_BYTES = 32 * 1024 * 1024;

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function sha256ForSmallFile(file: File) {
  if (file.size > MAX_BROWSER_HASH_BYTES) {
    return null;
  }

  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function DocumentUpload({ projectId, documents, trashedDocuments, storageReady }: DocumentUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetDocumentIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function uploadFile(file: File, documentId: string | null) {
    setError(null);
    setStatus(file.size <= MAX_BROWSER_HASH_BYTES ? "Obliczanie sumy kontrolnej" : "Przygotowywanie dużego pliku");

    const digest = await sha256ForSmallFile(file);

    const mimeType = file.type || "application/octet-stream";
    const prepareResponse = await fetch("/api/storage/upload-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId,
        documentId,
        fileName: file.name,
        mimeType,
        fileSize: file.size
      })
    });

    if (!prepareResponse.ok) {
      const payload = await prepareResponse.json().catch(() => null);
      throw new Error(payload?.error ?? "Nie udało się wygenerować adresu uploadu.");
    }

    const upload = (await prepareResponse.json()) as UploadResponse;
    setStatus("Wysyłanie pliku do R2");

    const putResponse = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.headers,
      body: file
    });

    if (!putResponse.ok) {
      throw new Error(`R2 odrzucił upload: HTTP ${putResponse.status}`);
    }

    setStatus("Zapisywanie dokumentu w Supabase");
    const completeResponse = await fetch("/api/storage/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token: upload.token,
        sha256: digest
      })
    });

    if (!completeResponse.ok) {
      const payload = await completeResponse.json().catch(() => null);
      throw new Error(payload?.error ?? "Nie udało się zapisać dokumentu.");
    }

    setStatus("Dokument zapisany");
    startTransition(() => router.refresh());
  }

  async function handleFiles(files: FileList | null) {
    if (!storageReady) {
      return;
    }

    const file = files?.[0];

    if (!file) {
      return;
    }

    try {
      setIsUploading(true);
      await uploadFile(file, targetDocumentIdRef.current);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload nie powiódł się.");
      setStatus(null);
    } finally {
      setIsUploading(false);
      targetDocumentIdRef.current = null;
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function openFilePicker(documentId: string | null = null) {
    targetDocumentIdRef.current = documentId;
    inputRef.current?.click();
  }

  async function downloadVersion(versionId: string) {
    setError(null);
    setStatus("Przygotowywanie pobierania");

    try {
      const response = await fetch("/api/storage/download-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ projectId, versionId })
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

  async function changeDocumentState(documentId: string, state: "active" | "trashed") {
    setError(null);
    setStatus(state === "trashed" ? "Przenoszenie dokumentu do kosza" : "Przywracanie dokumentu");

    try {
      const response = await fetch("/api/storage/document-state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ projectId, documentId, state })
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
    <div className="documents-layout">
      <div className="upload-panel">
        <input ref={inputRef} type="file" onChange={(event) => handleFiles(event.target.files)} disabled={!storageReady} />
        <button
          type="button"
          className="primary-button"
          onClick={() => openFilePicker()}
          disabled={isPending || isUploading || !storageReady}
        >
          <UploadCloud size={18} aria-hidden="true" />
          Dodaj plik
        </button>
        {!storageReady ? (
          <p className="form-message">Dokumentacja będzie dostępna po zakończeniu aktualizacji bazy.</p>
        ) : null}
        {status ? <p className="upload-status">{status}</p> : null}
        {error ? <p className="form-message form-message--error">{error}</p> : null}
      </div>

      <div className="document-list">
        {documents.length > 0 ? (
          documents.map((document) => {
            const version = document.document_versions?.[0];

            return (
              <article key={document.id} className="document-row">
                <FileText size={18} aria-hidden="true" />
                <div>
                  <h3>{document.name}</h3>
                  <p>
                    {version?.mime_type ?? "plik"} / {version ? formatFileSize(version.file_size_bytes) : "bez wersji"} /{" "}
                    {version ? `wersja ${version.version_number}` : "oczekuje"}
                  </p>
                </div>
                {version ? (
                  <div className="document-row__actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => downloadVersion(version.id)}
                      disabled={isUploading}
                    >
                      <Download size={16} aria-hidden="true" />
                      Pobierz
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openFilePicker(document.id)}
                      disabled={isUploading || !storageReady}
                    >
                      <FilePlus2 size={16} aria-hidden="true" />
                      Nowa wersja
                    </button>
                    <button
                      type="button"
                      className="secondary-button secondary-button--danger"
                      onClick={() => changeDocumentState(document.id, "trashed")}
                      disabled={isUploading || isPending}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      Do kosza
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="empty-state empty-state--compact">
            <h3>Brak dokumentów</h3>
            <p>Pierwszy PDF, ZIP albo kosztorys utworzy wpis w Supabase i obiekt w R2.</p>
          </div>
        )}
      </div>

      {trashedDocuments.length > 0 ? (
        <section className="trash-panel">
          <div>
            <p className="eyebrow">Kosz</p>
            <p>{trashedDocuments.length} dokumentów — pliki w R2 nie zostały usunięte.</p>
          </div>
          <div className="document-list">
            {trashedDocuments.map((document) => (
              <article key={document.id} className="document-row document-row--trashed">
                <Trash2 size={18} aria-hidden="true" />
                <div>
                  <h3>{document.name}</h3>
                  <p>Przeniesiono do kosza</p>
                </div>
                <div className="document-row__actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => changeDocumentState(document.id, "active")}
                    disabled={isPending}
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                    Przywróć
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
