"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, LoaderCircle } from "lucide-react";
import styles from "./investment-autopilot.module.css";

type Payload = { error?: string; prepared?: number; materialDrafts?: number; protocolDrafts?: number; scheduleDrafts?: number; superseded?: number };

export function AutopilotRunButton({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  function run() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/projects/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, action: "run" }) });
      const payload = await response.json().catch(() => null) as Payload | null;
      if (!response.ok) { setMessage(payload?.error ?? "Nie udało się uruchomić Autopilota."); return; }
      const prepared = payload?.prepared ?? 0, superseded = payload?.superseded ?? 0;
      setMessage(prepared || superseded ? `Przygotowano ${prepared} szkiców${superseded ? ` · ${superseded} starszych oznaczono jako nieaktualne` : ""}.` : "Stan jest zsynchronizowany — brak nowych bezpiecznych czynności do wykonania.");
      router.refresh();
    });
  }
  return <div className={compact ? styles.runCompact : styles.runWrap}><button type="button" className={compact ? styles.runButtonCompact : styles.runButton} onClick={run} disabled={pending}>{pending ? <LoaderCircle className={styles.spin} size={16} /> : <Bot size={16} />}{pending ? "Octopus pracuje…" : compact ? "Uruchom" : "Uruchom Investment Autopilot"}</button>{message ? <small className={styles.runMessage}>{message}</small> : null}</div>;
}
