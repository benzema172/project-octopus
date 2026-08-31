"use client";

import { useState, type ComponentProps, type KeyboardEvent, type MouseEvent } from "react";
import { HrLeaves161 } from "./hr-leaves-161";
import styles from "./hr-leaves-collapsed-162.module.css";

type Props = ComponentProps<typeof HrLeaves161>;

function isEmployeeRow(target: HTMLElement) {
  return target.closest<HTMLTableRowElement>('section[data-hr-leaves-161="1"] tbody tr[role="button"]');
}

function isInternallySelected(row: HTMLTableRowElement) {
  return row.getAttribute("aria-expanded") === "true"
    || Array.from(row.classList).some((name) => name.includes("rowSelected"));
}

export function HrLeavesCollapsed162(props: Props) {
  const [cardRevealed, setCardRevealed] = useState(false);

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const close = target.closest<HTMLButtonElement>('button[aria-label="Zwiń kartę urlopową"]');
    if (close) {
      event.preventDefault();
      event.stopPropagation();
      setCardRevealed(false);
      return;
    }

    const row = isEmployeeRow(target);
    if (!row) return;
    const selected = isInternallySelected(row);

    if (!cardRevealed) {
      setCardRevealed(true);
      // Przy jednym pracowniku stary komponent ma już wewnętrzne zaznaczenie.
      // Nie pozwalamy mu wtedy wykonać toggla do null, bo jego legacy effect
      // natychmiast otworzyłby kartę ponownie.
      if (selected) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (selected) {
      event.preventDefault();
      event.stopPropagation();
      setCardRevealed(false);
    }
  };

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target as HTMLElement;
    const row = isEmployeeRow(target);
    if (!row) return;
    const selected = isInternallySelected(row);

    if (!cardRevealed) {
      setCardRevealed(true);
      if (selected) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (selected) {
      event.preventDefault();
      event.stopPropagation();
      setCardRevealed(false);
    }
  };

  return <div
    className={styles.root}
    data-leave-card-revealed={cardRevealed ? "true" : "false"}
    onClickCapture={handleClickCapture}
    onKeyDownCapture={handleKeyDownCapture}
  >
    <HrLeaves161 {...props} />
  </div>;
}
