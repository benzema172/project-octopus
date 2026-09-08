"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CalendarDays, History, Search, TrendingDown, TrendingUp, X } from "lucide-react";
import { InvoiceQuickPreview } from "@/components/documents/invoice-quick-preview";
import { visibleWarehousePriceHistory450, warehouseInvoiceLabel450 } from "@/lib/warehouse/price-history-450";
import styles from "./warehouse-prices-500.module.css";

type Row = Record<string, unknown>;
type Filter = "all" | "alerts" | "up" | "down";
type Props = { workspaceId: string; items: Row[]; prices: Row[]; counterparties: Row[] };

const text = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const money = (value: unknown, currency = "PLN") => new Intl.NumberFormat("pl-PL", { style: "currency", currency: currency || "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0) || 0);
const pct = (value: number) => `${value > 0 ? "+" : ""}${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value)}%`;
const dateLabel = (value: unknown) => { const raw = String(value ?? ""); if (!raw) return "—"; const date = new Date(raw); return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("pl-PL").format(date); };
const normalized = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pl");
const id = (value: unknown) => { const result = String(value ?? "").trim(); return result || null; };
const invoiceLineId = (row: Row) => id(row.invoice_line_id) ?? (String(row.source_type ?? "") === "invoice_line" ? id(row.source_id) : null);
const priceChange = (history: Row[]) => {
  if (history.length < 2) return null;
  const latest = Number(history[0].unit_price_net ?? 0);
  const previous = Number(history[1].unit_price_net ?? 0);
  return previous > 0 ? ((latest - previous) / previous) * 100 : null;
};

export function WarehousePrices500({ workspaceId, items, prices, counterparties }: Props) {
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const counterpartyById = useMemo(() => new Map(counterparties.map((row) => [String(row.id), row])), [counterparties]);
  const histories = useMemo(() => {
    const raw = new Map<string, Row[]>();
    prices.forEach((row) => {
      const itemId = String(row.stock_item_id ?? row.stockItemId ?? "");
      if (itemId) raw.set(itemId, [...(raw.get(itemId) ?? []), row]);
    });
    const result = new Map<string, Row[]>();
    raw.forEach((rows, itemId) => result.set(itemId, visibleWarehousePriceHistory450(rows) as Row[]));
    return result;
  }, [prices]);

  const rows = useMemo(() => items.map((item) => {
    const itemId = String(item.id);
    const history = histories.get(itemId) ?? [];
    const latest = history[0];
    const change = priceChange(history);
    const supplier = latest ? counterpartyById.get(String(latest.counterparty_id)) : undefined;
    return { item, itemId, history, latest, change, supplier };
  }).filter((row) => row.latest), [counterpartyById, histories, items]);

  const alerts = useMemo(() => rows.filter((row) => row.change !== null && Math.abs(row.change) >= 10), [rows]);
  const increases = useMemo(() => alerts.filter((row) => Number(row.change) > 0).sort((a, b) => Number(b.change) - Number(a.change)), [alerts]);
  const decreases = useMemo(() => alerts.filter((row) => Number(row.change) < 0).sort((a, b) => Number(a.change) - Number(b.change)), [alerts]);
  const supplierCount = useMemo(() => new Set(rows.map((row) => String(row.latest?.counterparty_id ?? "")).filter(Boolean)).size, [rows]);
  const lastUpdate = useMemo(() => rows.reduce((latest, row) => {
    const value = String(row.latest?.observed_at ?? row.latest?.created_at ?? "");
    return value > latest ? value : latest;
  }, ""), [rows]);

  const filteredRows = useMemo(() => {
    const terms = normalized(query).split(/\s+/).filter(Boolean);
    return rows.filter((row) => {
      const change = row.change;
      if (filter === "alerts" && (change === null || Math.abs(change) < 10)) return false;
      if (filter === "up" && (change === null || change <= 0)) return false;
      if (filter === "down" && (change === null || change >= 0)) return false;
      if (!terms.length) return true;
      const haystack = normalized([
        row.item.name, row.item.sku, row.item.manufacturer, row.item.model,
        row.supplier?.name, row.latest?.invoice_number, warehouseInvoiceLabel450(row.latest ?? {}),
        row.latest?.source_type, row.latest?.unit_price_net, row.latest?.observed_at
      ].filter(Boolean).join(" "));
      return terms.every((term) => haystack.includes(term));
    }).sort((a, b) => String(b.latest?.observed_at ?? b.latest?.created_at ?? "").localeCompare(String(a.latest?.observed_at ?? a.latest?.created_at ?? "")));
  }, [filter, query, rows]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
    const nav = root?.querySelector<HTMLElement>('nav[aria-label="Sekcje Magazynu 3.1"]');
    if (!nav) return;
    const onClick = (event: Event) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!button) return;
      const label = button.textContent?.replace(/\s+/g, " ").trim() ?? "";
      setActive(label.startsWith("Ceny i dostawcy"));
    };
    nav.addEventListener("click", onClick);
    return () => nav.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!active) return;
    const root = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
    if (!root) return;
    let legacyWrapper: HTMLElement | null = null;
    let frame = 0;
    const hideLegacy = () => {
      const headings = Array.from(root.querySelectorAll<HTMLHeadingElement>("h2"));
      const heading = headings.find((node) => node.textContent?.trim() === "Ceny i dostawcy");
      const section = heading?.closest<HTMLElement>("section") ?? null;
      const wrapper = section?.parentElement ?? null;
      if (!wrapper) return;
      if (legacyWrapper && legacyWrapper !== wrapper) legacyWrapper.style.display = "";
      legacyWrapper = wrapper;
      legacyWrapper.style.display = "none";
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(hideLegacy);
    };
    hideLegacy();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (legacyWrapper) legacyWrapper.style.display = "";
    };
  }, [active]);

  const toggle = (itemId: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    return next;
  });

  if (!active) return null;

  return <section className={styles.shell} data-warehouse-prices-500="">
    <header className={styles.titleBar}>
      <div><small>CENY I DOSTAWCY</small><h2>Zakupy pod kontrolą</h2><p>Najważniejsze zmiany cen, dostawcy i pełna historia zakupów w jednym miejscu.</p></div>
    </header>

    <div className={styles.metrics}>
      <div><History size={16} /><span><small>Pozycje z historią</small><strong>{rows.length}</strong></span></div>
      <div><AlertTriangle size={16} /><span><small>Alerty ≥10%</small><strong>{alerts.length}</strong></span></div>
      <div><Building2 size={16} /><span><small>Aktywni dostawcy</small><strong>{supplierCount}</strong></span></div>
      <div><CalendarDays size={16} /><span><small>Ostatnia aktualizacja</small><strong>{dateLabel(lastUpdate)}</strong></span></div>
    </div>

    <div className={styles.signalGrid}>
      <section className={styles.signalCard}>
        <header><TrendingUp size={16} /><strong>Największe wzrosty</strong><span>{increases.length}</span></header>
        <div>{increases.slice(0, 6).map((row) => <button type="button" key={row.itemId} data-price-alert-item-id={row.itemId} className={styles.signalRow}>
          <span><strong>{text(row.item.name)}</strong><small>{money(row.latest?.unit_price_net, text(row.latest?.currency, "PLN"))} · {text(row.supplier?.name)}</small></span>
          <b className={styles.up}>{pct(Number(row.change))}</b>
        </button>)}{!increases.length ? <p className={styles.empty}>Brak istotnych wzrostów.</p> : null}</div>
      </section>
      <section className={styles.signalCard}>
        <header><TrendingDown size={16} /><strong>Największe spadki</strong><span>{decreases.length}</span></header>
        <div>{decreases.slice(0, 6).map((row) => <button type="button" key={row.itemId} data-price-alert-item-id={row.itemId} className={styles.signalRow}>
          <span><strong>{text(row.item.name)}</strong><small>{money(row.latest?.unit_price_net, text(row.latest?.currency, "PLN"))} · {text(row.supplier?.name)}</small></span>
          <b className={styles.down}>{pct(Number(row.change))}</b>
        </button>)}{!decreases.length ? <p className={styles.empty}>Brak istotnych spadków.</p> : null}</div>
      </section>
    </div>

    <section className={styles.historyCard}>
      <header className={styles.historyHeader}>
        <div><small>HISTORIA ZAKUPÓW</small><h2>Ceny i dostawcy</h2><p>{filteredRows.length} z {rows.length} kartotek · kliknij „Historia”, aby zobaczyć wcześniejsze zakupy.</p></div>
        <div className={styles.controls}>
          <label className={styles.search}><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produkt, dostawca, faktura…" aria-label="Szukaj w cenach i dostawcach" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Wyczyść"><X size={12} /></button> : null}</label>
          <div className={styles.filters}>
            {([ ["all", "Wszystkie"], ["alerts", "Alerty ≥10%"], ["up", "Wzrosty"], ["down", "Spadki"] ] as Array<[Filter, string]>).map(([id, label]) => <button type="button" key={id} className={filter === id ? styles.filterActive : ""} onClick={() => setFilter(id)}>{label}</button>)}
          </div>
        </div>
      </header>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Pozycja</th><th>Aktualna cena</th><th>Zmiana</th><th>Dostawca</th><th>Ostatni zakup</th><th>Faktura</th><th>Historia</th></tr></thead>
        {filteredRows.map((row) => {
          const isExpanded = expanded.has(row.itemId);
          return <tbody key={row.itemId}><tr>
            <td><strong>{text(row.item.name)}</strong><small>{[row.item.manufacturer, row.item.model, row.item.sku].filter(Boolean).join(" · ") || `${row.history.length} ${row.history.length === 1 ? "zakup" : "zakupów"}`}</small></td>
            <td><strong>{money(row.latest?.unit_price_net, text(row.latest?.currency, "PLN"))}</strong><small>{text(row.latest?.unit, row.item.unit as string)}</small></td>
            <td>{row.change === null ? <span>—</span> : <button type="button" data-price-alert-item-id={row.itemId} className={`${styles.changeButton} ${row.change > 0 ? styles.up : styles.down}`}>{pct(row.change)}</button>}</td>
            <td>{text(row.supplier?.name)}</td>
            <td>{dateLabel(row.latest?.observed_at ?? row.latest?.created_at)}</td>
            <td><InvoiceQuickPreview workspaceId={workspaceId} domain="warehouse" invoiceLineId={invoiceLineId(row.latest ?? {})} invoiceId={id(row.latest?.invoice_id)} invoiceNumber={id(row.latest?.invoice_number)} stockItemId={row.itemId}>{warehouseInvoiceLabel450(row.latest ?? {})}</InvoiceQuickPreview></td>
            <td><button type="button" className={styles.historyButton} aria-expanded={isExpanded} onClick={() => toggle(row.itemId)}>{isExpanded ? "Zwiń" : row.history.length > 1 ? `Historia (${row.history.length})` : "1 zakup"}</button></td>
          </tr>{isExpanded ? <tr className={styles.expandedRow}><td colSpan={7}><div className={styles.events}>{row.history.map((event, index) => <div className={styles.event} key={`${String(event.id)}:${index}`}>
            <span><small>Data</small><strong>{dateLabel(event.observed_at ?? event.created_at)}</strong></span>
            <span><small>Cena netto</small><strong>{money(event.unit_price_net, text(event.currency, "PLN"))}</strong></span>
            <span><small>Dostawca</small><strong>{text(counterpartyById.get(String(event.counterparty_id))?.name)}</strong></span>
            <span><small>Faktura</small><strong><InvoiceQuickPreview workspaceId={workspaceId} domain="warehouse" invoiceLineId={invoiceLineId(event)} invoiceId={id(event.invoice_id)} invoiceNumber={id(event.invoice_number)} stockItemId={row.itemId}>{warehouseInvoiceLabel450(event)}</InvoiceQuickPreview></strong></span>
          </div>)}</div></td></tr> : null}</tbody>;
        })}
      </table>{!filteredRows.length ? <p className={styles.empty}>Brak wyników dla wybranego filtra lub wyszukiwania.</p> : null}</div>
    </section>
  </section>;
}
