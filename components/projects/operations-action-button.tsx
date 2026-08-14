"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Play } from "lucide-react";

export function OperationsActionButton({ projectId, action, label }: { projectId: string; action: "initialize_closeout" | "create_forecast"; label: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  function run() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/projects/operations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, action })
      });
      const payload = await response.json() as { error?: string };
      setMessage(response.ok ? "Operacja została przygotowana." : payload.error ?? "Nie udało się wykonać operacji.");
      if (response.ok) router.refresh();
    });
  }
  return <div className="inline-action"><button type="button" className="primary-button" onClick={run} disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}{label}</button>{message ? <small>{message}</small> : null}</div>;
}
