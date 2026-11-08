"use client";
import { useEffect, useState } from "react";
import type { FieldQualityReport } from "@/lib/documents/field-quality";

const labels: Record<string, string> = { quantity: "Ilość", unit: "Jednostka", unitPrice: "Cena jednostkowa", totalPrice: "Wartość", netAmount: "Netto", grossAmount: "Brutto", taxAmount: "VAT", plannedStart: "Początek", plannedFinish: "Koniec", issueDate: "Data wystawienia", dueDate: "Termin płatności", documentNumber: "Numer dokumentu", quantityExecuted: "Wykonano", quantityAccepted: "Odebrano" };
const statuses = { verified: "potwierdzone odczytem", supported: "dowód wskazany przez AI", missing: "sprawdź źródło", conflict: "rozbieżność" };

export function DocumentFieldQuality({ workspaceId, documentId }: { workspaceId: string; documentId: string }) {
  const [open, setOpen] = useState(false), [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ report: FieldQualityReport | null; totalFields: number; segmentation?: { reason?: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/documents/quality?workspaceId=${encodeURIComponent(workspaceId)}&documentId=${encodeURIComponent(documentId)}&offset=${offset}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Nie udało się odczytać kontroli."); return body; })
      .then(body => { if (!controller.signal.aborted) { setData(body); setError(null); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Błąd kontroli."); });
    return () => controller.abort();
  }, [open, offset, workspaceId, documentId]);
  async function source(page?: number) {
    if (!data?.report) return;
    const tab = window.open("about:blank", "_blank"); if (tab) tab.opener = null;
    try {
      const response = await fetch("/api/storage/download-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, versionId: data.report.documentVersionId, disposition: "inline" }) });
      const body = await response.json(); if (!response.ok || !body.downloadUrl) throw new Error(body.error ?? "Nie udało się otworzyć źródła.");
      const url = body.downloadUrl + (page ? `#page=${page}` : "");
      if (tab) tab.location.replace(url); else window.location.assign(url);
    } catch (reason) { tab?.close(); setError(reason instanceof Error ? reason.message : "Błąd podglądu."); }
  }
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Kontrola pól i źródła</summary>
    {error ? <p role="alert">{error}</p> : null}
    {open && !data && !error ? <p>Sprawdzanie…</p> : null}
    {data?.segmentation?.reason ? <p role="status">{data.segmentation.reason}</p> : null}
    {data && !data.report ? <p>Ta wersja nie ma jeszcze szczegółowej kontroli pól. Dostępny jest oryginalny plik.</p> : null}
    {data?.report ? <>
      <p>{data.report.requiresReview ? "Sprawdź wskazane pola przed publikacją." : "Nie wykryto rozbieżności w sprawdzanych polach."} Kontrola nie jest gwarancją poprawności dokumentu.</p>
      {data.report.issues.map((issue, i) => <p key={i}>{issue.message}</p>)}
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Pole</th><th>Odczyt</th><th>Źródło</th><th>Kontrola</th></tr></thead><tbody>
        {data.report.fields.map(field => <tr key={field.path}>
          <td>{labels[field.path.split(".").at(-1) ?? ""] ?? field.path}<small> · {field.path.match(/\.\d+/)?.[0]?.slice(1) ? `pozycja ${Number(field.path.match(/\.\d+/)?.[0]?.slice(1)) + 1}` : "nagłówek"}</small></td>
          <td>{String(field.value ?? "—")}</td>
          <td>{field.source ? <button type="button" onClick={() => void source(field.source?.page)}>{field.source.locator || "Pokaż źródło"}</button> : "Brak dowodu"}{field.source?.quote ? <q>{field.source.quote}</q> : null}</td>
          <td>{statuses[field.status]}{field.reasons.map(reason => <small key={reason}> · {reason}</small>)}</td>
        </tr>)}
      </tbody></table></div>
      {data.totalFields > 50 ? <div><button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Poprzednie pola</button> <span>{offset + 1}–{Math.min(data.totalFields, offset + 50)} / {data.totalFields}</span> <button type="button" disabled={offset + 50 >= data.totalFields} onClick={() => setOffset(value => value + 50)}>Następne pola</button></div> : null}
    </> : null}
  </details>;
}
