"use client";

import { useEffect } from "react";

export function CompanyActionDockController() {
  useEffect(() => {
    const closeOtherActions = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const summary = target.closest(".ops-form-grid > details > summary");
      if (!(summary instanceof HTMLElement)) return;
      const current = summary.parentElement;
      if (!(current instanceof HTMLDetailsElement) || current.open) return;
      const dock = current.parentElement;
      if (!dock?.classList.contains("ops-form-grid")) return;

      for (const sibling of Array.from(dock.children)) {
        if (sibling instanceof HTMLDetailsElement && sibling !== current && sibling.open) sibling.open = false;
      }
    };

    document.addEventListener("click", closeOtherActions, true);
    return () => document.removeEventListener("click", closeOtherActions, true);
  }, []);

  return null;
}
