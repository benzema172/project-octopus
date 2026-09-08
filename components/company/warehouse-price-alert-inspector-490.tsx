"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, History, ReceiptText, TrendingDown, TrendingUp, X } from "lucide-react";
import { InvoiceQuickPreview } from "@/components/documents/invoice-quick-preview";
import { visibleWarehousePriceHistory450, warehouseInvoiceLabel450 } from "@/lib/warehouse/price-history-450";
import styles from "./warehouse-price-alert-inspector-490.module.css";

type Row = Record<string, unknown>;
type Props = { workspaceId: string; items: Row[]; prices: Row[]; counterparties: Row[] };

const text = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const money = (value: unknown, currency = "PLN") => new Intl.NumberFormat("pl-PL", { style: "currency", currency: currency || "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0) || 0);
const number = (value: unknown, digits = 2) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0) || 0);
const pct = (value: number) => `${value > 0 ? "+" : ""}${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value)}%`;
const dateLabel = (value: unknown) => { const raw = String(value ?? ""); if (!raw) return "—"; const date = new Date(raw); return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("pl-PL").format(date); };
const sourceLabel = (value: unknown) => ({ stock_movement_line: "zatwierdzony ruch magazynowy", warehouse_ai_line: "odczyt AI dokumentu", invoice_line: "pozycja faktury", business_document_line: "pozycja dokumentu zakupu" }[String(value)] ?? text(value, "zdarzenie zakupowe"));
const normalized = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pl");
const id = (value: unknown) => { const result = String(value ?? "").trim(); return result || null; };
const invoiceLineId = (row: Row) => id(row.invoice_line_id) ?? (String(row.source_type ?? "") === "invoice_line" ? id(row.source_id) : null);

export function WarehousePriceAlertInspector490({ workspaceId, items, prices, counterparties }: Props) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const counterpartyById = useMemo(() => new Map(counterparties.map((row) => [String(row.id), row])), [counterparties]);
  const itemIdsByName = useMemo(() => { const map = new Map<string, string>(); items.forEach((row) => { const name = normalized(row.name); if (name && !map.has(name)) map.set(name, String(row.id)); }); return map; }, [items]);
  const histories = useMemo(() => {
    const raw = new Map<string, Row[]>();
    prices.forEach((row) => { const itemId = String(row.stock_item_id ?? row.stockItemId ?? ""); if (itemId) raw.set(itemId, [...(raw.get(itemId) ?? []), row]); });
    const result = new Map<string, Row[]>(); raw.forEach((rows, itemId) => result.set(itemId, visibleWarehousePriceHistory450(rows) as Row[])); return result;
  }, [prices]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
    if (!root) return;
    let frame = 0;
    const decorate = () => {
      const panels = Array.from(root.querySelectorAll<HTMLElement>("section"));
      const panel = panels.find((node) => node.querySelector(":scope > header strong")?.textContent?.trim() === "Alerty zmian cen");
      const body = panel?.querySelector<HTMLElement>(":scope > div"); if (!body) return;
      Array.from(body.children).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const name = normalized(node.querySelector("strong")?.textContent); const itemId = itemIdsByName.get(name); if (!itemId) return;
        node.dataset.priceAlertItemId = itemId; node.tabIndex = 0; node.setAttribute("role", "button"); node.setAttribute("aria-label", `${node.querySelector("strong")?.textContent?.trim() ?? "Towar"} — pokaż wyliczenie zmiany ceny`); node.title = "Kliknij, aby zobaczyć skąd wynika zmiana ceny";
      });
    };
    const scheduleDecorate = () => { if (frame) window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(decorate); }); };
    const openFromTarget = (target: EventTarget | null) => { const element = target instanceof Element ? target.closest<HTMLElement>("[data-price-alert-item-id]") : null; if (!element?.dataset.priceAlertItemId) return false; setSelectedItemId(element.dataset.priceAlertItemId); return true; };
    const onClick = (event: Event) => { if (openFromTarget(event.target)) return; const button = event.target instanceof Element ? event.target.closest("button") : null; if (button?.textContent?.replace(/\s+/g, " ").trim().startsWith("Ceny i dostawcy")) scheduleDecorate(); };
    const onKeyDown = (event: KeyboardEvent) => { if (!["Enter", " "].includes(event.key)) return; if (!openFromTarget(event.target)) return; event.preventDefault(); };
    root.addEventListener("click", onClick); root.addEventListener("keydown", onKeyDown); scheduleDecorate();
    return () => { if (frame) window.cancelAnimationFrame(frame); root.removeEventListener("click", onClick); root.removeEventListener("keydown", onKeyDown); };
  }, [itemIdsByName]);

  const item = selectedItemId ? items.find((row) => String(row.id) === selectedItemId) : null;
  const history = selectedItemId ? histories.get(selectedItemId) ?? [] : [];
  const latest = history[0]; const previous = history[1]; const latestPrice = Number(latest?.unit_price_net ?? 0); const previousPrice = Number(previous?.unit_price_net ?? 0); const difference = latestPrice - previousPrice; const change = previousPrice > 0 ? difference / previousPrice * 100 : null;
  if (!item || !latest || !previous || change === null) return null;
  const latestSupplier = counterpartyById.get(String(latest.counterparty_id)); const previousSupplier = counterpartyById.get(String(previous.counterparty_id)); const currency = text(latest.currency, "PLN");

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedItemId(null); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="price-alert-title">
      <header className={styles.header}><div><small>WYLICZENIE ALERTU CENOWEGO</small><h2 id="price-alert-title">{text(item.name)}</h2><p>Porównanie dwóch ostatnich rzeczywistych zdarzeń cenowych tej kartoteki.</p></div><button type="button" onClick={() => setSelectedItemId(null)} aria-label="Zamknij"><X size={18} /></button></header>
      <section className={styles.summary}><div><small>Poprzednia cena</small><strong>{money(previousPrice, text(previous.currency, currency))}</strong><span>{dateLabel(previous.observed_at ?? previous.created_at)}</span></div><ArrowRight size={22} aria-hidden="true" /><div><small>Aktualna cena</small><strong>{money(latestPrice, currency)}</strong><span>{dateLabel(latest.observed_at ?? latest.created_at)}</span></div><div className={change >= 0 ? styles.changeUp : styles.changeDown}>{change >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}<strong>{pct(change)}</strong><small>{difference >= 0 ? "+" : ""}{money(difference, currency)}</small></div></section>
      <section className={styles.formula}><strong>Skąd bierze się {pct(change)}?</strong><code>({number(latestPrice)} − {number(previousPrice)}) ÷ {number(previousPrice)} × 100 = {pct(change)}</code></section>
      <div className={styles.comparison}><PriceEvent workspaceId={workspaceId} label="Poprzedni zakup" row={previous} supplier={previousSupplier} item={item} /><PriceEvent workspaceId={workspaceId} label="Aktualny zakup" row={latest} supplier={latestSupplier} item={item} /></div>
      <section className={styles.history}><header><History size={15} /><strong>Ostatnie zdarzenia cenowe</strong></header><div>{history.slice(0, 8).map((row, index) => <div className={styles.historyRow} key={`${String(row.id)}:${index}`}><span><strong>{money(row.unit_price_net, text(row.currency, "PLN"))}</strong><small>{dateLabel(row.observed_at ?? row.created_at)} · {text(counterpartyById.get(String(row.counterparty_id))?.name)}</small></span><span><small><InvoiceQuickPreview workspaceId={workspaceId} domain="warehouse" invoiceLineId={invoiceLineId(row)} invoiceId={id(row.invoice_id)} invoiceNumber={id(row.invoice_number)} stockItemId={id(row.stock_item_id)}>{warehouseInvoiceLabel450(row)}</InvoiceQuickPreview></small><small>{sourceLabel(row.source_type)}</small></span></div>)}</div></section>
    </aside>
  </div>;
}

function PriceEvent({ workspaceId, label, row, supplier, item }: { workspaceId: string; label: string; row: Row; supplier?: Row; item: Row }) {
  return <section className={styles.eventCard}><header><ReceiptText size={14} /><strong>{label}</strong></header><dl>
    <div><dt>Cena netto</dt><dd>{money(row.unit_price_net, text(row.currency, "PLN"))} / {text(row.unit, item.unit as string)}</dd></div>
    <div><dt>Data</dt><dd>{dateLabel(row.observed_at ?? row.created_at)}</dd></div>
    <div><dt>Dostawca</dt><dd>{text(supplier?.name)}</dd></div>
    <div><dt>Faktura</dt><dd><InvoiceQuickPreview workspaceId={workspaceId} domain="warehouse" invoiceLineId={invoiceLineId(row)} invoiceId={id(row.invoice_id)} invoiceNumber={id(row.invoice_number)} stockItemId={id(row.stock_item_id)}>{warehouseInvoiceLabel450(row)}</InvoiceQuickPreview></dd></div>
    <div><dt>Ilość</dt><dd>{number(row.quantity)} {text(row.unit, item.unit as string)}</dd></div>
    <div><dt>Źródło</dt><dd>{sourceLabel(row.source_type)}</dd></div>
  </dl></section>;
}
