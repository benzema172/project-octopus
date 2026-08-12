"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, FileText, Sparkles, UploadCloud, X } from "lucide-react";
import {
  DOCUMENT_DESTINATIONS,
  suggestDocumentClassification,
  type DocumentCategory
} from "@/lib/documents/classification";

type ProjectIntakeProps = {
  projectId: string;
};

type IntakeStatus = "ready" | "uploading" | "done" | "error";

type IntakeItem = {
  id: string;
  file: File;
  category: DocumentCategory;
  confidence: "wysoka" | "średnia" | "niska";
  reason: string;
  status: IntakeStatus;
  error?: string;
};

type UploadResponse = {
  uploadUrl: string;
  token: string;
  headers: Record<string, string>;
};

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv";
const MAX_BROWSER_HASH_BYTES = 32 * 1024 * 1024;

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isAccepted(file: File) {
  return /\.(pdf|docx?|xlsx?|csv)$/i.test(file.name);
}

async function sha256ForSmallFile(file: File) {
  if (file.size > MAX_BROWSER_HASH_BYTES) return null;
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fileIcon(fileName: string) {
  return /\.(xlsx?|csv)$/i.test(fileName) ? FileSpreadsheet : FileText;
}

export function ProjectIntake({ projectId }: ProjectIntakeProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<IntakeItem[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function addFiles(files: FileList | File[]) {
    setGeneralError(null);
    const accepted = Array.from(files).filter(isAccepted);
    const rejected = Array.from(files).length - accepted.length;

    if (rejected > 0) {
      setGeneralError("Wrzutnia obsługuje teraz PDF, Word oraz Excel/CSV. Pozostałe pliki pominięto.");
    }

    const next = accepted.map((file) => {
      const suggestion = suggestDocumentClassification(file.name, file.type);
      return {
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        category: suggestion.category,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        status: "ready" as const
      };
    });

    setItems((current) => [...current, ...next]);
  }

  function updateCategory(id: string, category: DocumentCategory) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, category } : item));
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function uploadItem(item: IntakeItem) {
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "uploading", error: undefined } : row));

    try {
      const digest = await sha256ForSmallFile(item.file);
      const mimeType = item.file.type || "application/octet-stream";
      const prepareResponse = await fetch("/api/storage/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          fileName: item.file.name,
          mimeType,
          fileSize: item.file.size
        })
      });

      if (!prepareResponse.ok) {
        const payload = await prepareResponse.json().catch(() => null);
        throw new Error(payload?.error ?? "Nie udało się przygotować uploadu.");
      }

      const upload = (await prepareResponse.json()) as UploadResponse;
      const putResponse = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body: item.file
      });

      if (!putResponse.ok) {
        throw new Error(`R2 odrzucił upload: HTTP ${putResponse.status}`);
      }

      const completeResponse = await fetch("/api/storage/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: upload.token, sha256: digest, category: item.category })
      });

      if (!completeResponse.ok) {
        const payload = await completeResponse.json().catch(() => null);
        throw new Error(payload?.error ?? "Nie udało się zapisać dokumentu.");
      }

      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "done" } : row));
      return true;
    } catch (error) {
      setItems((current) => current.map((row) => row.id === item.id ? {
        ...row,
        status: "error",
        error: error instanceof Error ? error.message : "Upload nie powiódł się."
      } : row));
      return false;
    }
  }

  async function uploadAll() {
    const waiting = items.filter((item) => item.status === "ready" || item.status === "error");
    let changed = false;

    for (const item of waiting) {
      changed = (await uploadItem(item)) || changed;
    }

    if (changed) {
      startTransition(() => router.refresh());
    }
  }

  const busy = items.some((item) => item.status === "uploading") || isPending;
  const readyCount = items.filter((item) => item.status === "ready" || item.status === "error").length;

  return (
    <div className="pw-intake">
      <button type="button" className="pw-intake-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <UploadCloud size={16} aria-hidden="true" />
        WRZUTNIA
      </button>

      {open ? (
        <div className="pw-intake-popover" role="dialog" aria-label="Wrzutnia dokumentów">
          <div className="pw-intake-head">
            <div>
              <p className="co-kicker">Centralne wejście plików</p>
              <h3>Wrzutnia</h3>
              <p>Octopus proponuje miejsce na podstawie nazwy i typu pliku. Ty możesz poprawić klasyfikację przed wysłaniem.</p>
            </div>
            <button type="button" className="pw-intake-close" onClick={() => setOpen(false)} aria-label="Zamknij Wrzutnię">
              <X size={17} />
            </button>
          </div>

          <input
            ref={inputRef}
            className="pw-intake-file-input"
            type="file"
            accept={ACCEPT}
            multiple
            onChange={(event) => event.target.files && addFiles(event.target.files)}
          />

          <button
            type="button"
            className={`pw-intake-dropzone ${dragging ? "is-dragging" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
            }}
          >
            <span className="pw-intake-cloud"><UploadCloud size={27} /></span>
            <strong>Przeciągnij tutaj PDF, Word lub Excel</strong>
            <small>albo kliknij, aby wybrać pliki z dysku</small>
          </button>

          <div className="pw-intake-ai-note">
            <Sparkles size={16} />
            <span><strong>Tryb bezpieczny:</strong> automatyczna sugestia + zatwierdzenie. Po uruchomieniu ekstrakcji treści Brain AI będzie dodatkowo potwierdzał klasyfikację zawartością dokumentu.</span>
          </div>

          {generalError ? <p className="pw-intake-error">{generalError}</p> : null}

          {items.length > 0 ? (
            <div className="pw-intake-list">
              {items.map((item) => {
                const Icon = fileIcon(item.file.name);
                return (
                  <article className={`pw-intake-row is-${item.status}`} key={item.id}>
                    <span className="pw-intake-file-icon"><Icon size={18} /></span>
                    <div className="pw-intake-file-main">
                      <strong title={item.file.name}>{item.file.name}</strong>
                      <small>{formatFileSize(item.file.size)} · pewność: {item.confidence}</small>
                      <p>{item.reason}</p>
                    </div>
                    <label className="pw-intake-destination">
                      <span>Przypisz do</span>
                      <select
                        value={item.category}
                        onChange={(event) => updateCategory(item.id, event.target.value as DocumentCategory)}
                        disabled={item.status === "uploading" || item.status === "done"}
                      >
                        {DOCUMENT_DESTINATIONS.map((destination) => (
                          <option key={destination.value} value={destination.value}>{destination.label}</option>
                        ))}
                      </select>
                    </label>
                    {item.status === "done" ? (
                      <span className="pw-intake-done"><CheckCircle2 size={17} /> Zapisano</span>
                    ) : (
                      <button type="button" className="pw-intake-remove" onClick={() => removeItem(item.id)} disabled={item.status === "uploading"}>Usuń</button>
                    )}
                    {item.error ? <p className="pw-intake-row-error">{item.error}</p> : null}
                  </article>
                );
              })}
            </div>
          ) : null}

          <div className="pw-intake-actions">
            <span>{items.length ? `${items.length} plików w kolejce` : "Możesz dodać kilka plików jednocześnie"}</span>
            <button type="button" onClick={uploadAll} disabled={busy || readyCount === 0}>
              <Sparkles size={16} />
              {busy ? "Przetwarzanie…" : `Wyślij i przypisz${readyCount ? ` (${readyCount})` : ""}`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
