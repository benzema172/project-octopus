"use client";

import { useLayoutEffect, useRef, type ComponentProps, type MouseEvent } from "react";
import { HrWorkspace148 } from "./hr-workspace-148";
import styles from "./hr-workspace-149.module.css";

type Props = ComponentProps<typeof HrWorkspace148> & {
  companyCity?: string | null;
};

const INLINE_HOST_ATTR = "data-hr-leave-inline-host";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char] ?? char));
}

function leaveSection(root: HTMLElement | null) {
  return root?.querySelector<HTMLElement>('section[data-hr-leaves-163="1"]') ?? null;
}

function currentDetails(section: HTMLElement) {
  return section.querySelector<HTMLElement>('article[class*="employeeDetails"]');
}

function inlineHost(section: HTMLElement) {
  return section.querySelector<HTMLTableRowElement>(`tr[${INLINE_HOST_ATTR}="1"]`);
}

function restoreDetails(section: HTMLElement) {
  const details = currentDetails(section);
  const host = inlineHost(section);
  if (details && host?.contains(details)) {
    details.classList.remove("hr-leave-inline-details");
    section.insertBefore(details, section.querySelector('[class*="modalLayer"]'));
  }
  host?.remove();
}

function attachDetailsToSelectedEmployee(section: HTMLElement) {
  const details = currentDetails(section);
  const selectedRow = section.querySelector<HTMLTableRowElement>('tbody tr[aria-expanded="true"]');
  let host = inlineHost(section);

  if (!details || !selectedRow) {
    if (details && host?.contains(details)) restoreDetails(section);
    else host?.remove();
    return;
  }

  if (!host) {
    host = document.createElement("tr");
    host.setAttribute(INLINE_HOST_ATTR, "1");
    host.className = "hr-leave-inline-row";
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "hr-leave-inline-cell";
    const shell = document.createElement("div");
    shell.className = "hr-leave-inline-shell";
    cell.appendChild(shell);
    host.appendChild(cell);
  }

  if (selectedRow.nextElementSibling !== host) selectedRow.insertAdjacentElement("afterend", host);
  const shell = host.querySelector<HTMLElement>(".hr-leave-inline-shell");
  if (shell && details.parentElement !== shell) shell.appendChild(details);
  details.classList.add("hr-leave-inline-details");
}

function applyCityToPreview(section: HTMLElement, city: string) {
  if (!city) return;
  const line = section.querySelector<HTMLElement>('[class*="paperFieldRight"] [class*="paperLine"]');
  if (!line) return;
  line.textContent = `${city}, ${new Date().toLocaleDateString("pl-PL")}`;
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
      const replaced = /^\.{6,},\s*\d{1,2}\.\d{1,2}\.\d{4}$/.test(String(text))
        ? `${city}, ${date}`
        : text;
      if (typeof maxWidth === "number") return originalFillText.call(this, replaced, x, y, maxWidth);
      return originalFillText.call(this, replaced, x, y);
    };
  }

  window.open = ((...args: unknown[]) => {
    const popup = (originalOpen as (...openArgs: unknown[]) => Window | null).apply(window, args);
    if (!popup) return popup;
    const originalWrite = popup.document.write.bind(popup.document);
    popup.document.write = ((...chunks: string[]) => {
      const replaced = chunks.map((chunk) => chunk.replace(/\.{6,},\s*(?=\d{1,2}\.\d{1,2}\.\d{4})/g, `${escapedCity}, `));
      return originalWrite(...replaced);
    }) as typeof popup.document.write;
    return popup;
  }) as typeof window.open;

  return () => {
    if (canvasPrototype && originalFillText && canvasPrototype.fillText !== originalFillText) canvasPrototype.fillText = originalFillText;
    if (window.open !== originalOpen) window.open = originalOpen;
  };
}

export function HrWorkspace149({ companyCity, ...props }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const city = String(companyCity ?? "").trim();

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let syncing = false;

    const sync = () => {
      if (syncing) return;
      syncing = true;
      try {
        const section = leaveSection(root);
        if (!section) return;
        attachDetailsToSelectedEmployee(section);
        applyCityToPreview(section, city);
      } finally {
        syncing = false;
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded", "class"] });

    return () => {
      observer.disconnect();
      const section = leaveSection(root);
      if (section) restoreDetails(section);
    };
  }, [city]);

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    const section = leaveSection(root);
    if (!section || !section.contains(event.target as Node)) return;
    const target = event.target as HTMLElement;

    const selectedRow = target.closest<HTMLTableRowElement>('tbody tr[aria-expanded="true"]');
    const closeButton = target.closest<HTMLButtonElement>('button[aria-label="Zwiń kartę urlopową"]');
    if (selectedRow || closeButton) restoreDetails(section);

    const button = target.closest<HTMLButtonElement>("button");
    const label = (button?.textContent ?? "").trim();
    if (!button || (!label.includes("PDF") && !label.includes("Drukuj"))) return;

    const restoreGenerators = patchDocumentGenerators(city);
    queueMicrotask(restoreGenerators);
  };

  return <div ref={rootRef} className={styles.root} onClickCapture={handleClickCapture}>
    <HrWorkspace148 {...props} />
  </div>;
}
