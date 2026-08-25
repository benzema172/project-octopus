import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("comprehensive functional and visual audit contracts", () => {
  it("makes the animated login discoverable and natively clickable", () => {
    const login = read("components/auth/project-octopus-login.tsx");
    const css = read("app/globals.css");

    expect(login).toContain("onClick={openLogin}");
    expect(login).toContain("Kliknij lub pociągnij mackę, aby się zalogować");
    expect(login).toContain('aria-label={handle.id === "upper-left" ? "Otwórz logowanie');
    expect(login).toContain('<span className="ux-sr-only">Login</span>');
    expect(login).toContain('<span className="ux-sr-only">Hasło</span>');
    expect(css).toContain(".v27-login-hint");
  });

  it("keeps gosc/gosc routed through the existing guest bootstrap", () => {
    const login = read("components/auth/project-octopus-login.tsx");
    const credentials = read("lib/demo/guest-constants.ts");

    expect(login).toContain('fetch("/api/auth/guest"');
    expect(login).toContain('if (!normalizedEmail.includes("@"))');
    expect(login).toContain("email: authEmail");
    expect(login).toContain("password: authPassword");
    expect(credentials).toContain('GUEST_PUBLIC_LOGIN = "gosc"');
    expect(credentials).toContain('GUEST_PUBLIC_PASSWORD = "gosc"');
  });

  it("removes the inherited 760px table width from mobile record cards", () => {
    const css = read("app/layout-density-audit.css");

    expect(css).toContain(".octopus-app-light .ops-table__row");
    expect(css).toContain(".octopus-app-light .ops-table > div:not(.ops-table__head)");
    expect(css).toContain("min-width: 0 !important");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) !important");
    expect(css).toContain("overflow-wrap: anywhere");
  });

  it("keeps the assistant and release marker in separate safe-area lanes", () => {
    const workspaceCss = read("app/layout-density-audit.css");
    const badgeCss = read("app/release-badge.css");

    expect(workspaceCss).toContain("bottom: calc(52px + env(safe-area-inset-bottom))");
    expect(workspaceCss).toContain("bottom: calc(44px + env(safe-area-inset-bottom))");
    expect(badgeCss).toContain("max(8px, env(safe-area-inset-right))");
    expect(badgeCss).toContain("max(8px, env(safe-area-inset-bottom))");
  });

  it("locks, traps and restores focus for mobile navigation and record drawers", () => {
    const shell = read("components/layout/company-shell.tsx");
    const moduleShell = read("components/company/operations/module-shell.tsx");

    expect(shell).toContain('window.matchMedia("(max-width: 980px)")');
    expect(shell).toContain('document.body.style.overflow = "hidden"');
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain("inert={isMobile && !mobileOpen ? true : undefined}");
    expect(shell).toContain("menuButtonRef.current?.focus()");
    expect(moduleShell).toContain("drawerCloseRef.current?.focus()");
    expect(moduleShell).toContain("lastRowTriggerRef.current?.focus()");
  });

  it("uses non-interactive controls for unavailable pagination directions", () => {
    const pagination = read("components/system/server-pagination.tsx");
    const css = read("app/layout-density-audit.css");

    expect(pagination).toContain('<span className="secondary-button is-disabled" aria-disabled="true">');
    expect(pagination).not.toContain("href={page<=1");
    expect(css).toContain(".server-pagination");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  it("keeps every mobile cost-flow step visible without a hidden horizontal rail", () => {
    const css = read("app/finance-compact.css");

    expect(css).toContain("@media (max-width: 520px)");
    expect(css).toContain(".enterprise-flow-steps");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(css).toContain(".enterprise-flow-counters");
    expect(css).toContain("flex-wrap: wrap");
  });

  it("does not present a capped company action queue as an exact total", () => {
    const actionCenter = read("components/company/company-action-center.tsx");

    expect(actionCenter).toContain("Co najmniej ${items.length} aktywnych");
  });

  it("fails the full migration audit when a foreign key column lacks an index", () => {
    const validator = read("scripts/validate-all-migrations-local.mjs");
    const migration = read("supabase/migrations/20260824110000_foreign_key_index_hardening.sql");

    expect(validator).toContain("const unindexedForeignKeys");
    expect(validator).toContain("Foreign key columns without an index");
    expect(validator).toContain("i.indpred is null");
    expect(migration).toContain("create index if not exists %I");
    expect(migration).toContain("fk.attnum = any(i.indkey)");
  });
});
