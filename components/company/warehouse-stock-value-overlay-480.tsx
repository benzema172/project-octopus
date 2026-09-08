"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { operationalStockValue } from "@/lib/warehouse/stock-value";
import styles from "./warehouse-workspace-310.module.css";

type Row = Record<string, unknown>;

type Props = {
  items: Row[];
  prices: Row[];
  balances: Row[];
  costLayers: Row[];
};

const money = (value: unknown) =>
  new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 2
  }).format(Number(value ?? 0) || 0);

const rowTimestamp = (row: Row) => {
  const parsed = Date.parse(String(row.observed_at ?? row.created_at ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

export function WarehouseStockValueOverlay480({ items, prices, balances, costLayers }: Props) {
  const hostRef = useRef<HTMLElement | null>(null);
  const legacyBodyRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const biggest = useMemo(() => {
    const balanceByItem = new Map<string, number>();
    balances.forEach((row) => {
      const itemId = String(row.stock_item_id ?? row.stockItemId ?? "");
      if (!itemId) return;
      balanceByItem.set(itemId, (balanceByItem.get(itemId) ?? 0) + Number(row.quantity ?? 0));
    });

    const fifoByItem = new Map<string, { quantity: number; value: number }>();
    costLayers.forEach((row) => {
      const itemId = String(row.stock_item_id ?? row.stockItemId ?? "");
      if (!itemId) return;
      const quantity = Math.max(0, Number(row.remaining_quantity ?? 0) || 0);
      const value = quantity * Math.max(0, Number(row.unit_cost ?? 0) || 0);
      const current = fifoByItem.get(itemId) ?? { quantity: 0, value: 0 };
      fifoByItem.set(itemId, { quantity: current.quantity + quantity, value: current.value + value });
    });

    const latestPriceByItem = new Map<string, { price: number; timestamp: number }>();
    prices.forEach((row) => {
      const itemId = String(row.stock_item_id ?? row.stockItemId ?? "");
      if (!itemId) return;
      const currency = String(row.currency ?? "PLN").trim().toUpperCase();
      if (currency && currency !== "PLN") return;
      const price = Number(row.unit_price_net ?? 0);
      if (!Number.isFinite(price) || price <= 0) return;
      const timestamp = rowTimestamp(row);
      const current = latestPriceByItem.get(itemId);
      if (!current || timestamp >= current.timestamp) latestPriceByItem.set(itemId, { price, timestamp });
    });

    return items
      .map((item) => {
        const itemId = String(item.id ?? "");
        const fifo = fifoByItem.get(itemId) ?? { quantity: 0, value: 0 };
        const value = operationalStockValue({
          balance: balanceByItem.get(itemId) ?? 0,
          fifoQuantity: fifo.quantity,
          fifoValue: fifo.value,
          latestUnitPrice: latestPriceByItem.get(itemId)?.price ?? 0
        });
        return { item, value };
      })
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value || String(a.item.name ?? "").localeCompare(String(b.item.name ?? ""), "pl"))
      .slice(0, 6);
  }, [balances, costLayers, items, prices]);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let attachFrame = 0;
    let syncFrame = 0;
    let disposed = false;

    const teardown = (updateState = true) => {
      if (legacyBodyRef.current) {
        legacyBodyRef.current.style.display = "";
        delete legacyBodyRef.current.dataset.octopusStockValueLegacy;
        legacyBodyRef.current = null;
      }
      hostRef.current?.remove();
      hostRef.current = null;
      if (updateState) setHost(null);
    };

    const sync = () => {
      if (disposed) return;
      const scope = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
      if (!scope) return;

      if (hostRef.current && !hostRef.current.isConnected) {
        hostRef.current = null;
        legacyBodyRef.current = null;
        setHost(null);
      }

      const panels = Array.from(scope.querySelectorAll<HTMLElement>("section"));
      const panel = panels.find((candidate) => {
        const directHeader = Array.from(candidate.children).find((node) => node.tagName === "HEADER") as HTMLElement | undefined;
        return directHeader?.querySelector("strong")?.textContent?.trim() === "Największa wartość zapasu";
      });

      if (!panel) {
        if (hostRef.current || legacyBodyRef.current) teardown();
        return;
      }

      if (hostRef.current?.parentElement === panel) return;
      teardown();

      const legacyBody = Array.from(panel.children).find((node) => node.tagName === "DIV") as HTMLElement | undefined;
      if (!legacyBody) return;

      legacyBody.dataset.octopusStockValueLegacy = "4.8";
      legacyBody.style.display = "none";
      const nextHost = document.createElement("div");
      nextHost.dataset.octopusStockValueHost = "4.8";
      legacyBody.after(nextHost);
      legacyBodyRef.current = legacyBody;
      hostRef.current = nextHost;
      setHost(nextHost);
    };

    const scheduleSync = () => {
      if (disposed || syncFrame) return;
      syncFrame = window.requestAnimationFrame(() => {
        syncFrame = 0;
        sync();
      });
    };

    const attach = () => {
      if (disposed) return;
      const scope = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
      if (!scope) {
        attachFrame = window.requestAnimationFrame(attach);
        return;
      }
      observer = new MutationObserver(scheduleSync);
      observer.observe(scope.parentElement ?? scope, { subtree: true, childList: true });
      sync();
    };

    attach();
    return () => {
      disposed = true;
      observer?.disconnect();
      if (attachFrame) window.cancelAnimationFrame(attachFrame);
      if (syncFrame) window.cancelAnimationFrame(syncFrame);
      teardown(false);
    };
  }, []);

  if (!host || !host.isConnected) return null;

  return createPortal(
    biggest.length ? (
      biggest.map(({ item, value }) => (
        <div className={styles.simpleRow} key={String(item.id)}>
          <span>
            <strong>{String(item.name ?? "Pozycja magazynowa")}</strong>
            <small>{item.sku ? String(item.sku) : "bez SKU"}</small>
          </span>
          <b>{money(value)}</b>
        </div>
      ))
    ) : (
      <div className={styles.empty}>Brak dodatniego stanu z wiarygodną ceną zakupu.</div>
    ),
    host
  );
}
