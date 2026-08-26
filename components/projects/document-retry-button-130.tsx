"use client";

import { useState } from "react";
import { RefreshCw, Zap } from "lucide-react";
import { useRouter } from "next/navigation";

export function DocumentRetryButton130({ workspaceId, documentId, force = false }: { workspaceId: string; documentId: string; force?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "waiting" | "error">("idle");

  async function retry() {
    if (state === "loading") return;
    setState("loading");
    try {
      const response = await fetch("/api/brain/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, documentId, force })
      });
      const payload = await response.json().catch(() => null) as { status?: string } | null;
      if (!response.ok) throw new Error("retry_failed");
      setState(payload?.status === "waiting_rate_limit" ? "waiting" : "done");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  const label = state === "loading"
    ? force ? "Wymuszam…" : "Ponawiam…"
    : state === "done"
      ? force ? "Analiza uruchomiona" : "Dodano do kolejki"
      : state === "waiting"
        ? "Limit nadal aktywny"
        : state === "error"
          ? "Spróbuj ponownie"
          : force ? "Wymuś ponowienie teraz" : "Ponów analizę";

  return (
    <button
      type="button"
      className="pi130-retry"
      onClick={retry}
      disabled={state === "loading"}
      title={force ? "Natychmiast spróbuj ponownie mimo aktywnego oczekiwania na limit Gemini" : "Ponów ekstrakcję, analizę AI, routing i Autopilot"}
    >
      {force ? <Zap size={13} aria-hidden="true" /> : <RefreshCw size={13} className={state === "loading" ? "is-spinning" : undefined} aria-hidden="true" />}
      {label}
    </button>
  );
}
