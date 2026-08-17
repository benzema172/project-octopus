"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, RotateCcw } from "lucide-react";

export function CloseoutStatusButton({ projectId, requirementId, complete }: { projectId: string; requirementId: string; complete: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function update() {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/projects/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "closeout_requirement_update", requirementId, status: complete ? "missing" : "complete" })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) setError(payload.error ?? "Nie udało się zmienić checklisty.");
      else router.refresh();
    });
  }

  return <div className="inline-action"><button type="button" className={complete ? "secondary-button" : "approve-button"} onClick={update} disabled={pending}>{pending ? <LoaderCircle className="spin" size={14} /> : complete ? <RotateCcw size={14} /> : <Check size={14} />}{complete ? "Cofnij" : "Oznacz kompletne"}</button>{error ? <small>{error}</small> : null}</div>;
}
