"use client";

import { useEffect } from "react";

const MOVEMENT_SUCCESS = "Ruch zatwierdzono i stan magazynowy został zaktualizowany.";
const DISMISS_AFTER_MS = 5000;

const normalizedLabel = (value: string | null | undefined) => String(value ?? "").replace(/\s+/g, " ").trim();

export function WarehouseUiCleanup520() {
  useEffect(() => {
    let root: HTMLElement | null = null;
    let observer: MutationObserver | null = null;
    let attachFrame = 0;
    let disposed = false;
    const timers = new Set<number>();

    const scheduleMovementSuccessDismiss = (scope: HTMLElement) => {
      const banners = Array.from(scope.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === "DIV");
      banners.forEach((banner) => {
        if (!normalizedLabel(banner.textContent).includes(MOVEMENT_SUCCESS)) return;
        if (banner.dataset.octopusAutoDismiss === "1") return;
        banner.dataset.octopusAutoDismiss = "1";
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          if (!banner.isConnected) return;
          banner.style.transition = "opacity .18s ease, max-height .22s ease, padding .22s ease, margin .22s ease, border-width .22s ease";
          banner.style.opacity = "0";
          banner.style.maxHeight = "0";
          banner.style.paddingTop = "0";
          banner.style.paddingBottom = "0";
          banner.style.marginTop = "0";
          banner.style.marginBottom = "0";
          banner.style.borderWidth = "0";
          banner.style.overflow = "hidden";
          banner.style.pointerEvents = "none";
        }, DISMISS_AFTER_MS);
        timers.add(timer);
      });
    };

    const removeLocationsUi = (scope: HTMLElement) => {
      const nav = scope.querySelector<HTMLElement>('nav[aria-label="Sekcje Magazynu 3.1"]');
      const buttons = nav ? Array.from(nav.querySelectorAll<HTMLButtonElement>("button")) : [];
      const locationsButton = buttons.find((button) => normalizedLabel(button.textContent).startsWith("Lokalizacje"));
      if (locationsButton) {
        locationsButton.style.display = "none";
        locationsButton.tabIndex = -1;
        locationsButton.setAttribute("aria-hidden", "true");
      }

      const panels = Array.from(scope.querySelectorAll<HTMLElement>("section"));
      panels.forEach((panel) => {
        const title = normalizedLabel(panel.querySelector(":scope > header strong")?.textContent);
        if (title === "Lokalizacje regałowe / QR" || title === "Magazyny i lokalizacje") {
          panel.style.display = "none";
        }
      });

      const locationForm = Array.from(scope.querySelectorAll<HTMLElement>("form")).find((form) => normalizedLabel(form.querySelector(":scope > strong")?.textContent) === "Dodaj lokalizację / regał");
      if (locationForm) locationForm.style.display = "none";
    };

    const apply = () => {
      if (!root?.isConnected) return;
      removeLocationsUi(root);
      scheduleMovementSuccessDismiss(root);
    };

    const attach = () => {
      if (disposed) return;
      root = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
      if (!root) {
        attachFrame = window.requestAnimationFrame(attach);
        return;
      }
      observer = new MutationObserver(apply);
      observer.observe(root, { subtree: true, childList: true });
      apply();
    };

    attach();
    return () => {
      disposed = true;
      observer?.disconnect();
      if (attachFrame) window.cancelAnimationFrame(attachFrame);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return null;
}
