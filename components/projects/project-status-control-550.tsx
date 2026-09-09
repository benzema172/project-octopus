"use client";

import { Archive, Check, ChevronDown, CirclePause, CirclePlay, LoaderCircle, RotateCcw } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./project-status-control-550.module.css";

type Props = {
  projectId: string;
  status: string;
  canManage: boolean;
  variant?: "header" | "portfolio";
};

type StatusOption = {
  value: string;
  label: string;
  description: string;
};

const OPTIONS: StatusOption[] = [
  { value: "preparation", label: "Przygotowanie", description: "Dostępna do bieżącej pracy i przypisań." },
  { value: "active", label: "Aktywna", description: "Bieżąca realizacja — dostępna w Kadrach i operacjach." },
  { value: "paused", label: "Wstrzymana", description: "Pozostaje w portfelu, ale nie jest dostępna do nowych przypisań." },
  { value: "completed", label: "Zakończona", description: "Nie można jej wybierać do nowej pracy pracowników." },
  { value: "archived", label: "Archiwum", description: "Pełna historia zachowana; inwestycję można później przywrócić." }
];

const LABELS: Record<string, string> = {
  planned: "Planowana",
  tender: "Przetarg",
  preparation: "Przygotowanie",
  active: "Aktywna",
  paused: "Wstrzymana",
  completed: "Zakończona",
  archived: "Archiwum"
};

function iconFor(status: string) {
  if (status === "archived") return <Archive size={13} aria-hidden="true" />;
  if (status === "completed") return <Check size={13} aria-hidden="true" />;
  if (status === "paused") return <CirclePause size={13} aria-hidden="true" />;
  return <CirclePlay size={13} aria-hidden="true" />;
}

function confirmation(current: string, next: string) {
  if (next === "completed") {
    return "Oznaczyć inwestycję jako zakończoną? Zniknie z nowych wyborów operacyjnych, m.in. z kalendarza pracy pracowników. Cała historia i dokumentacja pozostaną zachowane.";
  }
  if (next === "archived") {
    return "Przenieść inwestycję do Archiwum? Zniknie z bieżącej pracy, ale zachowa pełną dokumentację i będzie można ją później przywrócić.";
  }
  if ((current === "completed" || current === "archived") && (next === "active" || next === "preparation")) {
    return "Przywrócić inwestycję do bieżącej pracy? Ponownie będzie można wybierać ją w Kadrach i innych operacyjnych modułach.";
  }
  if (current === "archived" && next === "completed") {
    return "Przywrócić inwestycję z Archiwum do listy Zakończonych? Nadal pozostanie niedostępna do nowych przypisań pracowników.";
  }
  return null;
}

export function ProjectStatusControl550({ projectId, status, canManage, variant = "header" }: Props) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = LABELS[status] ?? status;
  const globalClass = variant === "header" ? "pw-project-status" : "co-investment-status";

  if (!canManage) {
    return <span className={globalClass}>{label}</span>;
  }

  const changeStatus = (nextStatus: string) => {
    if (nextStatus === status || pending) return;
    const copy = confirmation(status, nextStatus);
    if (copy && !window.confirm(copy)) return;
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/projects/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, status: nextStatus })
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Nie udało się zmienić statusu inwestycji.");
        if (detailsRef.current) detailsRef.current.open = false;
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Nie udało się zmienić statusu inwestycji.");
      }
    });
  };

  return <div className={`${styles.root} ${variant === "portfolio" ? styles.portfolio : styles.header}`} data-project-status-control="550">
    <details ref={detailsRef}>
      <summary className={`${styles.trigger} ${globalClass}`} title="Kliknij, aby zmienić status inwestycji">
        {pending ? <LoaderCircle className={styles.spin} size={13} aria-hidden="true" /> : iconFor(status)}
        <span>{label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </summary>
      <div className={styles.menu} role="menu" aria-label="Zmień status inwestycji">
        <div className={styles.menuTitle}>Zmień status inwestycji</div>
        {OPTIONS.map((option) => <button
          type="button"
          key={option.value}
          role="menuitem"
          className={option.value === status ? styles.activeOption : undefined}
          disabled={pending || option.value === status}
          onClick={() => changeStatus(option.value)}
        >
          <span className={styles.optionIcon}>{option.value === status ? <Check size={14} /> : option.value === "archived" ? <Archive size={14} /> : option.value === "paused" ? <CirclePause size={14} /> : option.value === "completed" ? <Check size={14} /> : <CirclePlay size={14} />}</span>
          <span><strong>{option.label}</strong><small>{option.description}</small></span>
          {status === "archived" && option.value === "completed" ? <RotateCcw size={13} aria-label="Przywróć" /> : null}
        </button>)}
      </div>
    </details>
    {error ? <span className={styles.error} role="alert">{error}</span> : null}
  </div>;
}
