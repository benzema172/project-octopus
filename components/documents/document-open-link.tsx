"use client";

import { useState, type MouseEvent } from "react";

type DocumentOpenLinkProps = {
  workspaceId: string;
  projectId: string | null;
  versionId: string | null;
  fallbackHref: string;
};

type DownloadUrlResponse = {
  downloadUrl?: string;
  error?: string;
};

export function DocumentOpenLink({ workspaceId, projectId, versionId, fallbackHref }: DocumentOpenLinkProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen(event: MouseEvent<HTMLAnchorElement>) {
    if (!versionId || busy) return;

    event.preventDefault();
    setBusy(true);
    setError(null);

    const previewWindow = window.open("about:blank", "_blank");
    if (previewWindow) previewWindow.opener = null;

    try {
      const response = await fetch("/api/storage/download-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, projectId, versionId, disposition: "inline" })
      });
      const payload = await response.json().catch(() => null) as DownloadUrlResponse | null;
      if (!response.ok || !payload?.downloadUrl) {
        throw new Error(payload?.error ?? "Nie udało się przygotować podglądu dokumentu.");
      }

      if (previewWindow) previewWindow.location.replace(payload.downloadUrl);
      else window.location.assign(payload.downloadUrl);
    } catch (openError) {
      previewWindow?.close();
      setError(openError instanceof Error ? openError.message : "Nie udało się otworzyć dokumentu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <a
      href={fallbackHref}
      onClick={handleOpen}
      aria-busy={busy}
      title={error ?? (versionId ? "Otwórz plik w bezpiecznym podglądzie" : "Brak zapisanej wersji pliku")}
    >
      {busy ? "Otwieranie…" : error ? "Ponów otwarcie →" : versionId ? "Otwórz →" : "Szczegóły →"}
    </a>
  );
}
