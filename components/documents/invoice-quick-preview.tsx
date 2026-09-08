"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { Domain } from "@/lib/authorization";
import styles from "./invoice-quick-preview.module.css";

type Row = Record<string, unknown>;
type Payload = {
  invoice: Row;
  counterparty: Row | null;
  lines: Row[];
  targetLineId: string | null;
  document: { id: unknown; projectId: unknown; versionId: unknown; name: unknown; category: unknown } | null;
  version: Row | null;
  source: Row | null;
  error?: string;
};
type Props = {
  workspaceId: string;
  domain: Domain;
  invoiceLineId?: string | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  stockItemId?: string | null;
  children: ReactNode;
  className?: string;
};

const cache = new Map<string, Payload>();
const str = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const num = (value: unknown, digits = 2) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0) || 0);
const money = (value: unknown, currency = "PLN") => new Intl.NumberFormat("pl-PL", { style: "currency", currency: currency || "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0) || 0);
const dateLabel = (value: unknown) => value ? new Intl.DateTimeFormat("pl-PL").format(new Date(String(value))) : "—";

function visibleLines(lines: Row[], targetLineId: string | null) {
  if (lines.length <= 8) return lines.map((line) => ({ kind: "line" as const, line }));
  const targetIndex = Math.max(0, lines.findIndex((line) => String(line.id) === targetLineId));
  const start = Math.max(0, targetIndex - 2);
  const end = Math.min(lines.length, targetIndex + 3);
  const result: Array<{ kind: "line"; line: Row } | { kind: "ellipsis"; key: string }> = [];
  if (start > 0) result.push({ kind: "ellipsis", key: "before" });
  for (let index = start; index < end; index += 1) result.push({ kind: "line", line: lines[index] });
  if (end < lines.length) result.push({ kind: "ellipsis", key: "after" });
  return result;
}

export function InvoiceQuickPreview({ workspaceId, domain, invoiceLineId, invoiceId, invoiceNumber, stockItemId, children, className }: Props) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const key = [workspaceId, domain, invoiceLineId, invoiceId, invoiceNumber, stockItemId].map((v) => v ?? "").join("|");
  const hasIdentity = Boolean(invoiceLineId || invoiceId || invoiceNumber);

  const place = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(540, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const preferBelow = rect.bottom + 390 < window.innerHeight;
    const top = preferBelow ? rect.bottom + 7 : Math.max(12, rect.top - 397);
    setPosition({ top, left });
  }, []);

  const load = useCallback(async () => {
    const cached = cache.get(key);
    if (cached) { setPayload(cached); return; }
    const params = new URLSearchParams({ workspaceId, domain });
    if (invoiceLineId) params.set("invoiceLineId", invoiceLineId);
    if (invoiceId) params.set("invoiceId", invoiceId);
    if (invoiceNumber) params.set("invoiceNumber", invoiceNumber.replace(/^FV\s+/i, ""));
    if (stockItemId) params.set("stockItemId", stockItemId);
    try {
      const response = await fetch(`/api/company/invoice-quick-preview?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as Payload;
      if (!response.ok) throw new Error(result.error ?? "Nie udało się odczytać faktury.");
      cache.set(key, result);
      setPayload(result);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się odczytać faktury.");
    }
  }, [domain, invoiceId, invoiceLineId, invoiceNumber, key, stockItemId, workspaceId]);

  const show = useCallback((immediate = false) => {
    if (!hasIdentity) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const action = () => { place(); setOpen(true); void load(); };
    if (immediate) action();
    else openTimer.current = setTimeout(action, 160);
  }, [hasIdentity, load, place]);
  const hide = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, place]);
  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (["Enter", " "].includes(event.key)) { event.preventDefault(); show(true); }
  };

  const invoice = payload?.invoice;
  const currency = str(invoice?.currency, "PLN");
  const sourcePage = payload?.source ? Number(payload.source.page_no ?? payload.source.page_number ?? 0) : 0;
  const fileHref = invoice?.id ? `/api/company/invoice-quick-preview/file?workspaceId=${encodeURIComponent(workspaceId)}&domain=${encodeURIComponent(domain)}&invoiceId=${encodeURIComponent(String(invoice.id))}${sourcePage ? `#page=${sourcePage}` : ""}` : "";
  const renderedLines = payload ? visibleLines(payload.lines, payload.targetLineId) : [];

  return <>
    <span ref={anchorRef} className={`${styles.anchor} ${className ?? ""}`} role={hasIdentity ? "button" : undefined} tabIndex={hasIdentity ? 0 : undefined}
      aria-label={hasIdentity ? `Szybki podgląd faktury ${invoiceNumber ?? ""}`.trim() : undefined}
      onMouseEnter={() => show(false)} onMouseLeave={hide} onFocus={() => show(true)} onBlur={hide} onClick={(event) => { event.stopPropagation(); show(true); }} onKeyDown={onKeyDown}>
      {children}
    </span>
    {open && typeof document !== "undefined" ? createPortal(
      <aside className={styles.popover} style={{ top: position.top, left: position.left }} role="dialog" aria-label="Szybki podgląd faktury"
        onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }} onMouseLeave={hide} onClick={(event) => event.stopPropagation()}>
        {!payload && !error ? <div className={styles.loading}>Ładowanie faktury…</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        {payload && invoice ? <>
          <header className={styles.head}><div><small>FAKTURA · SZYBKI PODGLĄD</small><strong>FV {str(invoice.invoice_number)}</strong><span>{str(payload.counterparty?.name)} · {dateLabel(invoice.issue_date)}</span></div>{fileHref ? <a className={styles.open} href={fileHref} target="_blank" rel="noreferrer">Oryginał <ExternalLink size={11}/></a> : null}</header>
          <div className={styles.summary}><div><small>Netto</small><strong>{money(invoice.net_amount, currency)}</strong></div><div><small>VAT</small><strong>{money(invoice.tax_amount, currency)}</strong></div><div><small>Brutto</small><strong>{money(invoice.gross_amount, currency)}</strong></div></div>
          <div className={styles.sheet}><div className={styles.sheetHead}><span>Lp.</span><span>Pozycja</span><span>Ilość</span><span>J.m.</span><span>Cena netto</span><span>Netto</span></div>
            {renderedLines.map((entry) => entry.kind === "ellipsis" ? <div className={styles.ellipsis} key={entry.key}>… pozostałe pozycje faktury …</div> : <div className={`${styles.line} ${String(entry.line.id) === payload.targetLineId ? styles.target : ""}`} key={String(entry.line.id)}><span>{str(entry.line.line_number)}</span><span>{str(entry.line.description)}</span><span className={styles.num}>{num(entry.line.quantity)}</span><span>{str(entry.line.unit)}</span><span className={styles.num}>{money(entry.line.unit_price, currency)}</span><span className={styles.num}>{money(entry.line.net_amount, currency)}</span></div>)}
          </div>
          <div className={styles.source}>{payload.targetLineId ? "Żółty wiersz to dokładna pozycja faktury powiązana z tym towarem/zdarzeniem." : "Nie znaleziono jednoznacznego powiązania pozycji — pokazano kontekst faktury."}{sourcePage ? ` Źródło wskazuje stronę ${sourcePage}.` : ""}</div>
          <div className={styles.hint}>Najedź, ustaw fokus lub kliknij numer faktury. Na telefonie użyj kliknięcia.</div>
        </> : null}
      </aside>, document.body) : null}
  </>;
}
