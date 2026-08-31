"use client";

import { useRef, type ComponentProps, type MouseEvent } from "react";
import { HrWorkspace148 } from "./hr-workspace-148";
import styles from "./hr-workspace-149.module.css";

type Props = ComponentProps<typeof HrWorkspace148> & {
  companyCity?: string | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char] ?? char));
}

function applyCityToPreview(root: HTMLElement | null, city: string) {
  if (!root || !city) return;
  for (const label of root.querySelectorAll<HTMLElement>("small")) {
    if ((label.textContent ?? "").trim() !== "(miejscowość i data)") continue;
    const line = label.previousElementSibling as HTMLElement | null;
    if (line) line.textContent = `${city}, ${new Date().toLocaleDateString("pl-PL")}`;
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

export function HrWorkspace149({ companyCity, ...props }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const city = String(companyCity ?? "").trim();

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!city) return;
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button");
    const label = (button?.textContent ?? "").trim();

    if (button && (label.includes("PDF") || label.includes("Drukuj"))) {
      const restore = patchDocumentGenerators(city);
      window.setTimeout(restore, 0);
    }

    // Podgląd i formularz są renderowane przez React. Po zakończeniu bieżącego kliknięcia
    // uzupełniamy wyłącznie pole miejscowości — bez obserwowania i przenoszenia całego DOM-u.
    window.requestAnimationFrame(() => applyCityToPreview(rootRef.current, city));
  };

  return <div ref={rootRef} className={styles.root} onClickCapture={handleClickCapture}>
    <HrWorkspace148 {...props} />
  </div>;
}
