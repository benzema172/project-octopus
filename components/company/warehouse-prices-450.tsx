"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Package } from "lucide-react";
import { visibleWarehousePriceHistory450, warehouseInvoiceLabel450 } from "@/lib/warehouse/price-history-450";
import styles from "./warehouse-workspace-310.module.css";

type Row = Record<string, unknown>;

type Props = {
  items: Row[];
  prices: Row[];
  counterparties: Row[];
  purchaseOrders: Row[];
};

const text = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const money = (value: unknown, currency = "PLN") => new Intl.NumberFormat("pl-PL", { style: "currency", currency: currency || "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0) || 0);
const pct = (value: number) => `${value > 0 ? "+" : ""}${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value)}%`;
const dateLabel = (value: unknown) => {
  const raw = String(value ?? "");
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("pl-PL").format(date);
};

function Panel({ title, children, icon }: { title: string; children: React.ReactNode; icon: React.ReactNode }) {
  return <section className={styles.panel}><header>{icon}<strong>{title}</strong></header><div>{children}</div></section>;
}

function Empty({ label = "Brak danych." }: { label?: string }) {
  return <div className={styles.empty}>{label}</div>;
}

function PurchaseCell({ row }: { row: Row }) {
  const invoice = warehouseInvoiceLabel450(row);
  return <span>{dateLabel(row.observed_at ?? row.created_at)}{invoice !== "—" ? <small>{invoice}</small> : null}</span>;
}

export function WarehousePrices450({ items, prices, counterparties, purchaseOrders }: Props) {
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(() => new Set());
  const counterpartyById = useMemo(() => new Map(counterparties.map((row) => [String(row.id), row])), [counterparties]);
  const pricesByItem = useMemo(() => {
    const raw = new Map<string, Row[]>();
    prices.forEach((row) => {
      const id = String(row.stock_item_id ?? row.stockItemId ?? "");
      if (!id) return;
      raw.set(id, [...(raw.get(id) ?? []), row]);
    });
    const result = new Map<string, Row[]>();
    raw.forEach((history, id) => result.set(id, visibleWarehousePriceHistory450(history)));
    return result;
  }, [prices]);

  const rows = useMemo(() => items
    .map((item) => ({ item, history: pricesByItem.get(String(item.id)) ?? [] }))
    .filter((row) => row.history.length > 0)
    .sort((a, b) => String(a.item.name ?? "").localeCompare(String(b.item.name ?? ""), "pl")), [items, pricesByItem]);

  const alerts = useMemo(() => rows.flatMap(({ item, history }) => {
    if (history.length < 2) return [];
    const latest = Number(history[0].unit_price_net ?? 0);
    const previous = Number(history[1].unit_price_net ?? 0);
    if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous <= 0) return [];
    const change = 100 * (latest - previous) / previous;
    return Math.abs(change) >= 10 ? [{ item, latest: history[0], change }] : [];
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)), [rows]);

  const eventCount = rows.reduce((sum, row) => sum + row.history.length, 0);
  const toggleHistory = (itemId: string) => setExpandedItemIds((current) => {
    const next = new Set(current);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    return next;
  });

  return <div className={styles.priceLayout} data-warehouse-prices="4.5">
    <Panel title="Alerty zmian cen" icon={<AlertTriangle size={16} />}>
      {alerts.slice(0, 12).map(({ item, latest, change }) => <div className={styles.simpleRow} key={String(item.id)}><span><strong>{text(item.name)}</strong><small>{money(latest.unit_price_net, text(latest.currency, "PLN"))} · {text(counterpartyById.get(String(latest.counterparty_id))?.name)}</small></span><b className={change > 0 ? styles.priceUp : styles.priceDown}>{pct(change)}</b></div>)}
      {!alerts.length ? <Empty label="Brak istotnych zmian cen (≥10%)." /> : null}
    </Panel>

    <Panel title="Ostatnie szkice zamówień" icon={<Package size={16} />}>
      {purchaseOrders.slice(0, 12).map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.order_number)}</strong><small>{text(row.status)} · {dateLabel(row.created_at)}</small></span><b>{money(row.total_amount, text(row.currency, "PLN"))}</b></div>)}
      {!purchaseOrders.length ? <Empty label="Szkice pojawią się po rekomendacjach uzupełnień." /> : null}
    </Panel>

    <section className={`${styles.section} ${styles.priceTable}`}>
      <header className={styles.sectionHeader}><div><small>HISTORIA</small><h2>Ceny i dostawcy</h2><p>Jedna kartoteka = jeden wiersz. Historia pokazuje rzeczywiste zdarzenia zakupu z datą i numerem faktury; techniczne źródła danych są ukryte.</p></div><b>{rows.length}</b></header>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Pozycja</th><th>Ostatnia cena netto</th><th>Jednostka</th><th>Ostatni dostawca</th><th>Ostatni zakup</th><th>Historia</th></tr></thead>
        {rows.map(({ item, history }) => {
          const itemId = String(item.id);
          const latest = history[0];
          const expanded = expandedItemIds.has(itemId);
          return <tbody key={itemId}>
            <tr>
              <td><strong>{text(item.name)}</strong><small>{history.length} {history.length === 1 ? "zakup" : "zakupów"}</small></td>
              <td>{money(latest.unit_price_net, text(latest.currency, "PLN"))}</td>
              <td>{text(latest.unit, item.unit as string)}</td>
              <td>{text(counterpartyById.get(String(latest.counterparty_id))?.name)}</td>
              <td><PurchaseCell row={latest} /></td>
              <td>{history.length > 1 ? <button type="button" className={styles.tableButton} aria-expanded={expanded} onClick={() => toggleHistory(itemId)}>{expanded ? "Zwiń" : `Rozwiń (${history.length})`}</button> : <span>1 zakup</span>}</td>
            </tr>
            {expanded ? <tr><td colSpan={6} style={{ background: "#fbfcfd", padding: "8px 10px 12px" }}><div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>Data zakupu</th><th>Faktura</th><th>Cena netto</th><th>Jednostka</th><th>Dostawca</th></tr></thead>
              <tbody>{history.map((price, index) => <tr key={`${String(price.id)}:${index}`}>
                <td>{dateLabel(price.observed_at ?? price.created_at)}</td>
                <td>{warehouseInvoiceLabel450(price)}</td>
                <td>{money(price.unit_price_net, text(price.currency, "PLN"))}</td>
                <td>{text(price.unit, item.unit as string)}</td>
                <td>{text(counterpartyById.get(String(price.counterparty_id))?.name)}</td>
              </tr>)}</tbody>
            </table></div></td></tr> : null}
          </tbody>;
        })}
      </table>{!rows.length ? <Empty /> : null}</div>
      <small style={{ color: "#7f8996", padding: "0 2px" }}>Łącznie: {eventCount} zdarzeń zakupu.</small>
    </section>
  </div>;
}
