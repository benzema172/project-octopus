"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { HrLeaves161 } from "./hr-leaves-161";

type Props = ComponentProps<typeof HrLeaves161>;

export function HrLeaves162(props: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const expandedRow = rootRef.current?.querySelector<HTMLTableRowElement>('tbody tr[aria-expanded="true"]');
        expandedRow?.click();
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  return <div ref={rootRef}><HrLeaves161 {...props} /></div>;
}
