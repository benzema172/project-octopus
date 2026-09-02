"use client";

import { useEffect, useRef, type ComponentProps, type MouseEvent } from "react";
import { HrWorkspaceCore300 } from "./hr-workspace-core-300";
import styles from "./hr-workspace-149.module.css";

type Props = ComponentProps<typeof HrWorkspaceCore300> & { companyCity?: string | null };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] ?? char));
}

function applyCityToPreview(root: HTMLElement | null, city: string) {
  if (!root || !city) return;
  const locationDate = `${city}, ${new Date().toLocaleDateString("pl-PL")}`;
  for (const label of root.querySelectorAll<HTMLElement>("small")) {
    if ((label.textContent ?? "").trim() !== "(miejscowość i data)") continue;
    const line = label.previousElementSibling as HTMLElement | null;
    if (line && line.textContent !== locationDate) line.textContent = locationDate;
  }
}

function patchDocumentGenerators(city: string) {
  if (!city) return () => undefined;
  const date = new Date().toLocaleDateString("pl-PL");
  const escapedCity = escapeHtml(city);
  const canvasPrototype = typeof CanvasRenderingContext2D !== "undefined" ? CanvasRenderingContext2D.prototype : null;
  const originalFillText = canvasPrototype?.fillText;
  const originalOpen = window.open;

  if (canvasPrototype && originalFillText) {
    canvasPrototype.fillText = function patchedFillText(text: string, x: number, y: number, maxWidth?: number) {
      const replaced = /^\.{6,},\s*\d{1,2}\.\d{1,2}\.\d{4}$/.test(String(text)) ? `${city}, ${date}` : text;
      if (typeof maxWidth === "number") return originalFillText.call(this, replaced, x, y, maxWidth);
      return originalFillText.call(this, replaced, x, y);
    };
  }

  window.open = ((...args: unknown[]) => {
    const popup = (originalOpen as (...openArgs: unknown[]) => Window | null).apply(window, args);
    if (!popup) return popup;
    const originalWrite = popup.document.write.bind(popup.document);
    popup.document.write = ((...chunks: string[]) => originalWrite(...chunks.map((chunk) => chunk.replace(/\.{6,},\s*(?=\d{1,2}\.\d{1,2}\.\d{4})/g, `${escapedCity}, `)))) as typeof popup.document.write;
    return popup;
  }) as typeof window.open;

  return () => {
    if (canvasPrototype && originalFillText) canvasPrototype.fillText = originalFillText;
    window.open = originalOpen;
  };
}

function findLeaveRowToggle(target: HTMLElement) {
  if (target.closest("button,a,input,select,textarea,label")) return null;
  const row = target.closest<HTMLTableRowElement>('section[data-hr-leaves-165="1"] tbody tr');
  if (!row || row.querySelector("td[colspan]")) return null;
  return row.querySelector<HTMLButtonElement>('button[aria-expanded]');
}

export function HrWorkspace149({ companyCity, ...props }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const city = String(companyCity ?? "").trim();

  useEffect(() => {
    if (!city || !rootRef.current) return;
    const root = rootRef.current;
    const syncPreview = () => applyCityToPreview(root, city);
    syncPreview();
    const observer = new MutationObserver(syncPreview);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [city]);

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const rowToggle = findLeaveRowToggle(target);
    if (rowToggle) {
      event.preventDefault();
      rowToggle.click();
      return;
    }

    if (!city) return;
    const button = target.closest<HTMLButtonElement>("button");
    if (!button) return;
    const label = (button.textContent ?? "").trim();
    const isDocumentAction = /(PDF|Drukuj|Podgląd|Generuj)/i.test(label);
    if (!isDocumentAction) return;

    if (/(PDF|Drukuj)/i.test(label)) {
      const restore = patchDocumentGenerators(city);
      window.setTimeout(restore, 0);
    }
    window.requestAnimationFrame(() => applyCityToPreview(rootRef.current, city));
  };

  return <div ref={rootRef} className={styles.root} onClickCapture={handleClickCapture}>
    <HrWorkspaceCore300 {...props} />
  </div>;
}
