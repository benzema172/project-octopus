"use client";

import { useState, useTransition } from "react";
import { Play, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

export function QueueWorkerButton({ workspaceId }: { workspaceId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  function runWorker() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch(`/api/brain/worker?workspaceId=${encodeURIComponent(workspaceId)}&limit=5`, { method: "POST" });
      const payload = await response.json() as { processed?: number; error?: string };
      setMessage(response.ok ? `Worker obsłużył ${payload.processed ?? 0} zadań.` : payload.error ?? "Nie udało się uruchomić workera.");
      router.refresh();
    });
  }

  return <div className="queue-worker-control"><button type="button" className="secondary-button" onClick={runWorker} disabled={pending}>{pending ? <RotateCcw className="spin" size={15} /> : <Play size={15} />}{pending ? "Worker pracuje…" : "Uruchom do 5 zadań"}</button>{message ? <small>{message}</small> : null}</div>;
}
