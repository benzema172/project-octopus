"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, X } from "lucide-react";

export function ReviewDecisionButton({ entityType, entityId, workspaceId }: { entityType: "estimate_import" | "change_impact" | "site_event" | "generation_run"; entityId: string; workspaceId?: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  function decide(action: "approve" | "reject") {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/brain/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, entityType, entityId, action }) });
      const payload = await response.json() as { error?: string };
      setMessage(response.ok ? "Decyzja została zapisana." : payload.error ?? "Nie udało się zapisać decyzji.");
      if (response.ok) router.refresh();
    });
  }
  return <div className="review-buttons"><button type="button" className="approve-button" disabled={pending} onClick={() => decide("approve")}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Zatwierdź</button><button type="button" className="reject-button" disabled={pending} onClick={() => decide("reject")}><X size={14} />Odrzuć</button>{message ? <small>{message}</small> : null}</div>;
}
