"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BrainCircuit,
  Boxes,
  CarFront,
  ChartNoAxesCombined,
  ChevronDown,
  FileStack,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  UsersRound,
  WalletCards,
  Wrench,
  X
} from "lucide-react";
import type { Domain } from "@/lib/authorization";

const OctopusAssistant = dynamic(
  () => import("@/components/ai/octopus-assistant").then((module) => module.OctopusAssistant),
  { ssr: false, loading: () => null }
);

type CompanyShellProps = {
  workspaceId: string;
  companyName: string;
  userEmail: string;
  allowedDomains: Domain[];
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  projectRoutes?: boolean;
  domain?: Domain;
  domains?: Domain[];
  group: "primary" | "tools";
};

export function CompanyShell({ workspaceId, companyName, userEmail, allowedDomains, children }: CompanyShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [assistantReady, setAssistantReady] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const base = `/workspace/companies/${workspaceId}`;

  useEffect(() => {
    // Nie dokładamy OctopusAI do krytycznej ścieżki renderowania. Wcześniejsze
    // uruchamianie po 650 ms zbiegało się z ładowaniem danych modułu firmy.
    const timeoutId = window.setTimeout(() => setAssistantReady(true), 2500);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 980px)");
    const syncMobile = () => setIsMobile(media.matches);
    syncMobile();
    media.addEventListener("change", syncMobile);
    return () => media.removeEventListener("change", syncMobile);
  }, []);

  useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobile, mobileOpen]);

  const allItems: NavItem[] = [
    { href: base, label: "Pulpit", icon: LayoutDashboard, exact: true, group: "primary" },
    { href: `${base}/investments`, label: "Inwestycje", icon: FolderKanban, projectRoutes: true, domain: "investments", group: "primary" },
    { href: `${base}/finances`, label: "Finanse", icon: WalletCards, domain: "finance", group: "primary" },
    { href: `${base}/hr`, label: "Kadry", icon: UsersRound, domain: "hr", group: "primary" },
    { href: `${base}/warehouse`, label: "Magazyn", icon: Boxes, domain: "warehouse", group: "primary" },
    { href: `${base}/fleet`, label: "Flota", icon: CarFront, domain: "fleet", group: "primary" },
    { href: `${base}/documents`, label: "Dokumenty", icon: FileStack, domain: "investments", group: "primary" },
    { href: `${base}/ai-center`, label: "OctopusAI", icon: BrainCircuit, domains: ["investments", "templates", "reports"], group: "tools" },
    { href: `${base}/reports`, label: "Raporty", icon: ChartNoAxesCombined, domain: "reports", group: "tools" },
    { href: `${base}/settings`, label: "Ustawienia", icon: Settings, domain: "settings", group: "tools" }
  ];
  const items = allItems.filter((item) => (!item.domain || allowedDomains.includes(item.domain)) && (!item.domains || item.domains.some((domain) => allowedDomains.includes(domain))));

  const isActive = (item: NavItem) => {
    if (item.exact) return pathname === item.href;
    if (item.href === `${base}/ai-center` && (pathname.startsWith(`${base}/ai-inbox`) || pathname.startsWith(`${base}/search`))) return true;
    return pathname.startsWith(item.href) || Boolean(item.projectRoutes && pathname.startsWith("/workspace/projects/"));
  };

  const primaryItems = items.filter((item) => item.group === "primary");
  const toolItems = items.filter((item) => item.group === "tools");
  const toolsActive = toolItems.some(isActive);
  const [toolsOpen, setToolsOpen] = useState(toolsActive);

  const closeMobileMenu = () => {
    setMobileOpen(false);
    if (isMobile) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const renderLink = (item: NavItem) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <Link
        href={item.href}
        key={item.href}
        prefetch={false}
        className={active ? "is-active" : undefined}
        aria-current={active ? "page" : undefined}
        onClick={closeMobileMenu}
      >
        <Icon size={18} aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="co-shell">
      <header className="co-mobile-bar">
        <button ref={menuButtonRef} type="button" className="co-mobile-menu-button" aria-label="Otwórz menu firmy" aria-controls="company-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
          <Menu size={19} aria-hidden="true" />
        </button>
        <span><small>Aktywna firma</small><strong>{companyName}</strong></span>
        <Link prefetch={false} href="/workspace" className="co-mobile-menu-button" aria-label="Zmień firmę" title="Zmień firmę"><ArrowLeftRight size={18} aria-hidden="true" /></Link>
      </header>

      <button type="button" className={`co-sidebar-backdrop${mobileOpen ? " is-visible" : ""}`} aria-label="Zamknij menu" aria-hidden={!mobileOpen} onClick={closeMobileMenu} tabIndex={mobileOpen ? 0 : -1} />

      <aside className={`co-sidebar${mobileOpen ? " is-mobile-open" : ""}`} id="company-navigation" aria-label="Nawigacja firmy" inert={isMobile && !mobileOpen ? true : undefined}>
        <div className="co-sidebar-mobile-head"><strong>Menu firmy</strong><button type="button" onClick={closeMobileMenu} aria-label="Zamknij menu firmy"><X size={18} aria-hidden="true" /></button></div>
        <Link prefetch={false} href="/workspace" className="co-sidebar-brand" onClick={closeMobileMenu}><strong>OCTOPUS</strong><span>Project Octopus</span></Link>

        <div className="co-company-switcher">
          <div className="co-company-switcher__topline"><small>Aktywna firma</small><Link prefetch={false} href="/workspace" className="co-company-switcher__change" aria-label="Zmień firmę" title="Zmień firmę"><ArrowLeftRight size={15} aria-hidden="true" /></Link></div>
          <strong>{companyName}</strong>
        </div>

        <div className="co-sidebar-menu">
          <p className="co-sidebar-section-label">Moduły</p>
          <nav className="co-sidebar-nav" aria-label="Główne moduły firmy">{primaryItems.map(renderLink)}</nav>

          {toolItems.length ? (
            <details className="co-sidebar-tools" open={toolsActive || toolsOpen} onToggle={(event) => setToolsOpen(event.currentTarget.open)}>
              <summary><Wrench size={17} aria-hidden="true" /><span>Narzędzia</span><ChevronDown className="co-sidebar-tools__chevron" size={15} aria-hidden="true" /></summary>
              <nav aria-label="Narzędzia i ustawienia firmy">{toolItems.map(renderLink)}</nav>
            </details>
          ) : null}
        </div>

        <div className="co-sidebar-footer">
          <div><small>Zalogowano jako</small><span title={userEmail}>{userEmail}</span></div>
          <form action="/auth/sign-out" method="post"><button type="submit" className="co-icon-button" aria-label="Wyloguj"><LogOut size={18} aria-hidden="true" /></button></form>
        </div>
      </aside>

      <div className="co-main" id="main-content" tabIndex={-1}>{children}</div>
      {assistantReady ? <OctopusAssistant workspaceId={workspaceId} companyName={companyName} /> : null}
    </div>
  );
}
