"use client";

import { useEffect } from "react";

type Row = Record<string, unknown>;

type Props = { projects: Row[] };

const OPERATIONAL = new Set(["preparation", "active"]);

/**
 * Cross-cutting UX guard for legacy and lazy-loaded HR project selectors.
 * The database remains the source-of-truth guard; this layer prevents users
 * from even selecting a paused/completed/archived project for new work.
 * Historical rows keep their current project label and become read-only.
 */
export function HrOperationalProjectGuard540({ projects }: Props) {
  useEffect(() => {
    const blocked = new Map(
      projects
        .filter((project) => project.id && !OPERATIONAL.has(String(project.status ?? "")))
        .map((project) => [String(project.id), String(project.status ?? "closed")])
    );
    if (!blocked.size) return;

    const apply = () => {
      const root = document.querySelector<HTMLElement>("[data-hr-core]");
      if (!root) return;
      for (const select of root.querySelectorAll<HTMLSelectElement>("select")) {
        const options = Array.from(select.options);
        const isOperationalSelector = options.some((option) => /koszt ogólny/i.test(option.textContent ?? ""));
        if (!isOperationalSelector) continue;

        const selectedBlocked = blocked.has(select.value);
        for (const option of options) {
          const status = blocked.get(option.value);
          if (!status) continue;
          option.disabled = true;
          option.hidden = !selectedBlocked || option.value !== select.value;
          option.dataset.projectLifecycleBlocked = status;
        }

        if (selectedBlocked) {
          select.dataset.projectLifecycleReadonly = "1";
          const form = select.closest("form");
          if (form) {
            for (const field of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("input,select,textarea,button[type='submit']")) {
              field.disabled = true;
              field.dataset.projectLifecycleReadonly = "1";
            }
          } else {
            select.disabled = true;
          }
        }
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    const root = document.querySelector<HTMLElement>("[data-hr-core]");
    if (root) observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [projects]);

  return null;
}
