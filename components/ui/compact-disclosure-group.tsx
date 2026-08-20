"use client";

import { Children, type ReactNode, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

export type CompactDisclosureItem = {
  id: string;
  label: string;
  meta?: string | number | null;
  attention?: boolean;
};

type Props = {
  items: CompactDisclosureItem[];
  children: ReactNode;
  defaultOpenId?: string | null;
  className?: string;
};

export function CompactDisclosureGroup({ items, children, defaultOpenId = null, className = "" }: Props) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);
  const panels = Children.toArray(children);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash && items.some((item) => item.id === hash)) setOpenId(hash);
  }, [items]);

  return (
    <section className={`compact-disclosure-group ${className}`.trim()}>
      <div className="compact-disclosure-group__triggers" role="group" aria-label="Dodatkowe sekcje">
        {items.map((item) => {
          const active = openId === item.id;
          return (
            <button
              key={item.id}
              id={item.id}
              type="button"
              className={`compact-disclosure-group__trigger${active ? " is-active" : ""}${item.attention ? " is-attention" : ""}`}
              aria-expanded={active}
              aria-controls={`${item.id}-panel`}
              onClick={() => setOpenId((current) => current === item.id ? null : item.id)}
            >
              <span>{item.label}</span>
              {item.meta !== undefined && item.meta !== null && String(item.meta) !== "" ? <small>{String(item.meta)}</small> : null}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {items.map((item, index) => (
        <div
          key={`${item.id}-panel`}
          id={`${item.id}-panel`}
          className="compact-disclosure-group__panel"
          hidden={openId !== item.id}
        >
          {panels[index] ?? null}
        </div>
      ))}
    </section>
  );
}
