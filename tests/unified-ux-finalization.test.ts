import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const ordered = (content: string, labels: string[]) => labels.every((label, index) => index === 0 || content.indexOf(labels[index - 1]) < content.indexOf(label));

describe("unified UX finalization", () => {
  it("opens operational records in an accessible detail drawer", () => {
    const shell = read("components/company/operations/module-shell.tsx");
    expect(shell).toContain("selectedRow");
    expect(shell).toContain("ops-table__row--interactive");
    expect(shell).toContain("onKeyDown");
    expect(shell).toContain('event.key !== "Enter" && event.key !== " "');
    expect(shell).toContain("ops-record-drawer");
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain('aria-modal="true"');
    expect(shell).toContain("detailTitle");
    expect(shell).toContain("detailContent");
  });

  it("makes HR exception-first and keeps employee context in the drawer", () => {
    const dashboard = read("components/company/hr/hr-dashboard-core-300.tsx");
    const registry = read("components/company/hr/hr-employee-registry-300.tsx");
    expect(ordered(dashboard, ["Aktywni", "Problemy krytyczne", "Terminy ≤30 dni", "Do decyzji"])).toBe(true);
    expect(dashboard).toContain("Co wymaga działania");
    expect(registry).toContain("onOpenTime");
    expect(registry).toContain("issueSummary");
  });

  it("makes Warehouse exception-first and exposes stock movement context", () => {
    const warehouse = read("components/company/operations/warehouse-operations.tsx");
    expect(ordered(warehouse, ["Poniżej minimum", "Ruchy do akceptacji", "Rezerwacje"])).toBe(true);
    expect(warehouse).toContain("detailContent=");
    expect(warehouse).toContain("Stan kartoteki");
    expect(warehouse).toContain("Ostatnie ruchy");
    expect(warehouse).toContain("Rezerwacje");
  });

  it("makes Fleet exception-first and exposes vehicle context", () => {
    const fleet = read("components/company/operations/fleet-operations.tsx");
    expect(ordered(fleet, ["Dokumenty do 30 dni", "Serwisy do 30 dni", "Otwarte szkody"])).toBe(true);
    expect(fleet).toContain("detailContent=");
    expect(fleet).toContain("Dane pojazdu");
    expect(fleet).toContain("Dokumenty i terminy");
    expect(fleet).toContain("Serwis");
  });

  it("loads the drawer layer after the base simplification layer and supports mobile", () => {
    const layout = read("app/layout.tsx");
    const css = read("app/unified-ux-finalization.css");
    expect(layout.indexOf('import "./unified-ux-simplification.css"')).toBeLessThan(layout.indexOf('import "./unified-ux-finalization.css"'));
    expect(css).toContain(".ops-record-drawer-layer");
    expect(css).toContain(".ops-record-drawer__backdrop");
    expect(css).toContain("@media (max-width: 560px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
