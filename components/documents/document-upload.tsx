"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, UploadCloud } from "lucide-react";
import type { DocumentSummary } from "@/lib/types";

type DocumentUploadProps = {
  projectId: string;
  documents: DocumentSummary[];
};

type UploadResponse = {
  uploadUrl: string;
  token: string;
  headers: Record<string, string>;
};

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function sha256(file: File) {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function DocumentUpload({ projectId, documents }: DocumentUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function uploadFile(file: File) {
    setError(null);
    setStatus("Przygotowywanie uploadu");

    const mimeType = file.type || "application/octet-stream";
    const prepareResponse = await fetch("/api/storage/upload-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId,
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

    const digest = await sha256(file);
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
    const file = files?.[0];

    if (!file) {
      return;
    }

    try {
      await uploadFile(file);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload nie powiódł się.");
      setStatus(null);
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  return (
    <div className="documents-layout">
      <div className="upload-panel">
        <input ref={inputRef} type="file" onChange={(event) => handleFiles(event.target.files)} />
        <button type="button" className="primary-button" onClick={() => inputRef.current?.click()} disabled={isPending}>
          <UploadCloud size={18} aria-hidden="true" />
          Dodaj plik
        </button>
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
                    {version?.upload_status ?? "oczekuje"}
                  </p>
                </div>
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
    </div>
  );
}
