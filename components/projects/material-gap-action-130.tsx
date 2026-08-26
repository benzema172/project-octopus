"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import type { MaterialGap130 } from "@/lib/data/project-intelligence-130";

export function MaterialGapAction130({ projectId, gap }: { projectId: string; gap: MaterialGap130 }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  async function createDraft() {
    if (state === "saving" || state === "done") return;
    setState("saving");
    try {
      const response = await fetch("/api/projects/material-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "save",
          title: gap.name,
          manufacturer: gap.manufacturer ?? "",
          productName: gap.name,
          model: gap.model ?? "",
          proposedUse: gap.installation ?? "Materiał rozpoznany w dokumentacji przez Octopus Brain",
          complianceSummary: `Szkic utworzony z propozycji AI. Źródło w Brain; pewność rozpoznania ${Math.round(gap.confidence * 100)}%. Wymaga weryfikacji przed wysłaniem.`,
          requestOrigin: "planned"
        })
      });
      if (!response.ok) throw new Error("save_failed");
      setState("done");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return <button type="button" className="pi130-action" onClick={createDraft} disabled={state === "saving" || state === "done"}>
    <Plus size={13} /> {state === "saving" ? "Tworzę…" : state === "done" ? "Szkic utworzony" : state === "error" ? "Spróbuj ponownie" : "Utwórz szkic WM"}
  </button>;
}
