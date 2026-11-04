"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Project = { id: string; name: string };
type Invoice = { id: string; net_amount: number; direction: string };
type InvoiceLine = { id: string; net_amount: number; quantity: number | null; line_type?: string | null };
type Plan = {
  type: string;
  invoice: Invoice | null;
  lines: InvoiceLine[];
  allocations: Array<{ source_line_id: string; status?: string; allocation_scope?: string }>;
  reviews: Array<{ review_type: string }>;
  projects: Project[];
};

type Props = {
  workspaceId: string;
  documentId: string;
  projects: Project[];
  canWrite: boolean;
  onAdvanced: () => void;
};

export function InvoiceInlineAssign({ workspaceId, documentId, projects, canWrite, onAdvanced }: Props) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!projectId || !canWrite || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Always refresh the canonical invoice and its lines before committing:
      // no browser-side prices or guessed inventory changes.
      const url = "/api/documents/decision-center?" + new URLSearchParams({ workspaceId, documentId });
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json() as Plan & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Nie można wczytać faktury.");
      if (data.type !== "purchase_invoice" || !data.invoice || data.invoice.direction !== "purchase")
        throw new Error("Ten dokument wymaga szczegółowego przypisania.");
      if (!data.projects.some(p => p.id === projectId))
        throw new Error("Ta inwestycja nie jest dostępna. Sprawdź uprawnienia.");
      if (!data.lines.length || data.lines.length > 160)
        throw new Error("Niekompletne pozycje faktury. Otwórz szczegóły.");
      if (data.reviews.some(r => ["source_conflict", "duplicate_candidate"].includes(r.review_type)))
        throw new Error("Wykryto niezgodność lub możliwy duplikat — otwórz szczegóły.");
      // Existing manual splits must never be replaced by a quick assignment.
      if (data.allocations.some(a => a.allocation_scope && a.allocation_scope !== "unassigned"))
        throw new Error("Ta faktura ma już przypisania. Otwórz szczegóły, aby ich nie nadpisać.");
      const assignments = data.lines.map(line => {
        const amount = Number(line.net_amount);
        const quantity = Number(line.quantity ?? 0);
        if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(quantity) || quantity < 0)
          throw new Error("Nieprawidłowe wartości pozycji. Otwórz szczegóły.");
        const isService = /service|usług/i.test(String(line.line_type ?? ""));
        return {
          lineId: line.id, scope: "project", projectId,
          materialScope: quantity > 0 && !isService ? "project" : "none",
          materialProjectId: quantity > 0 && !isService ? projectId : null,
          amount, quantity, costCode: ""
        };
      });
      const result = await fetch("/api/documents/decision-center", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "invoice", workspaceId, documentId, invoiceId: data.invoice.id, assignments })
      });
      const body = await result.json() as { error?: string };
      if (!result.ok) throw new Error(body.error ?? "Nie udało się przypisać faktury.");
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Przypisanie nie powiodło się.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="invoice-inline-assignment" onClick={event => event.stopPropagation()}>
    <select aria-label="Inwestycja dla faktury" value={projectId}
      disabled={!canWrite || saving || saved} onChange={event => { setProjectId(event.target.value); setError(null); }}>
      <option value="">Wybierz inwestycję…</option>
      {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
    <button type="button" onClick={() => void save()} disabled={!projectId || !canWrite || saving || saved}>
      {saving ? "Zapisywanie…" : saved ? "Zapisano" : "Zapisz"}
    </button>
    {error ? <div className="invoice-inline-assignment-error" role="alert">
      {error} <button type="button" onClick={onAdvanced}>Szczegóły</button>
    </div> : null}
  </div>;
}
