"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

export function DocumentRetryButton130({ workspaceId, documentId }: { workspaceId: string; documentId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function retry() {
    if (state === "loading") return;
    setState("loading");
    try {
      const response = await fetch("/api/brain/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, documentId })
      });
      if (!response.ok) throw new Error("retry_failed");
      setState("done");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <button type="button" className="pi130-retry" onClick={retry} disabled={state === "loading"} title="Ponów ekstrakcję, analizę AI, routing i Autopilot">
      <RefreshCw size={13} className={state === "loading" ? "is-spinning" : undefined} aria-hidden="true" />
      {state === "loading" ? "Ponawiam…" : state === "done" ? "Dodano do kolejki" : state === "error" ? "Spróbuj ponownie" : "Ponów analizę"}
    </button>
  );
}
