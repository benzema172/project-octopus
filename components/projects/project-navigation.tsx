"use client";

import Link from "next/link";
import {
  Archive,
  BarChart3,
  Brain,
  Calculator,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardCheck,
  Construction,
  Database,
  FileText,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Menu,
  PackageCheck,
  ShieldCheck,
  UsersRound,
  WalletCards,
  Warehouse
} from "lucide-react";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import type { Domain } from "@/lib/authorization";

type ProjectNavigationProps = { projectId: string; allowedDomains: Domain[] };
type ProjectNavItem = { href: string; label: string; icon: typeof LayoutDashboard; domain: Domain; exact?: boolean };
type ProjectNavGroup = { key: string; label: string; icon: typeof LayoutDashboard; items: ProjectNavItem[] };

function isItemActive(pathname: string, item: ProjectNavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function ProjectNavigation({ projectId, allowedDomains }: ProjectNavigationProps) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const mobileNavRef = useRef<HTMLDetailsElement>(null);
  const desktopNavRef = useRef<HTMLDivElement>(null);
  const base = `/workspace/projects/${projectId}`;

  const dashboard: ProjectNavItem = { href: base, label: "Pulpit", icon: LayoutDashboard, exact: true, domain: "investments" };
  const finance: ProjectNavItem = { href: `${base}/finance`, label: "Finanse", icon: WalletCards, exact: true, domain: "finance" };

  const navigationGroups: ProjectNavGroup[] = [
    {
      key: "project",
      label: "Projekt",
      icon: Database,
      items: [
        { href: `${base}/data`, label: "Dane inwestycji", icon: Database, domain: "investments" },
        { href: `${base}/documentation`, label: "Dokumentacja", icon: FileText, domain: "investments" },
        { href: `${base}/brain`, label: "Brain AI", icon: Brain, domain: "investments" }
      ]
    },
    {
      key: "execution",
      label: "Realizacja",
      icon: Construction,
      items: [
        { href: `${base}/tasks`, label: "Plan działań", icon: ListChecks, domain: "investments" },
        { href: `${base}/cost-estimate`, label: "Kosztorys / BOQ", icon: Calculator, domain: "investments" },
        { href: `${base}/schedule`, label: "Harmonogram", icon: CalendarDays, domain: "investments" },
        { href: `${base}/site`, label: "Budowa / dziennik", icon: Construction, domain: "investments" },
        { href: `${base}/progress`, label: "Przerób", icon: BarChart3, domain: "investments" },
        { href: `${base}/requests`, label: "Wnioski materiałowe", icon: PackageCheck, domain: "investments" },
        { href: `${base}/protocols`, label: "Protokoły i odbiory", icon: ClipboardCheck, domain: "investments" }
      ]
    },
    {
      key: "resources",
      label: "Zasoby",
      icon: UsersRound,
      items: [
        { href: `${base}/team`, label: "Zespół", icon: UsersRound, domain: "hr" },
        { href: `${base}/warehouse`, label: "Magazyn", icon: Warehouse, domain: "warehouse" }
      ]
    },
    {
      key: "control",
      label: "Kontrola",
      icon: Gauge,
      items: [
        { href: `${base}/control`, label: "Kontrola 360", icon: Gauge, domain: "investments" },
        { href: `${base}/reports`, label: "Raporty", icon: ChartNoAxesCombined, domain: "reports" }
      ]
    },
    {
      key: "closeout",
      label: "Zamknięcie",
      icon: ShieldCheck,
      items: [
        { href: `${base}/closeout`, label: "Zamknięcie inwestycji", icon: ShieldCheck, domain: "investments" },
        { href: `${base}/outputs`, label: "Wyniki i archiwum", icon: Archive, domain: "investments" }
      ]
    }
  ];

  const groups = navigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => allowedDomains.includes(item.domain)) }))
    .filter((group) => group.items.length > 0);
  const showDashboard = allowedDomains.includes(dashboard.domain);
  const showFinance = allowedDomains.includes(finance.domain);
  const activeItem = showDashboard && isItemActive(pathname, dashboard)
    ? dashboard
    : showFinance && isItemActive(pathname, finance)
      ? finance
      : groups.flatMap((group) => group.items).find((item) => isItemActive(pathname, item));

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      if (desktopNavRef.current && !desktopNavRef.current.contains(event.target as Node)) setOpenGroup(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenGroup(null);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const closeMobileNav = () => mobileNavRef.current?.removeAttribute("open");

  return (
    <nav className="project-navigation project-navigation--v5" aria-label="Menu inwestycji">
      <details className="pw-mobile-nav" ref={mobileNavRef}>
        <summary>
          <Menu size={17} aria-hidden="true" />
          <span><small>Menu inwestycji</small><strong>{activeItem?.label ?? "Wybierz sekcję"}</strong></span>
          <ChevronDown className="pw-mobile-nav__chevron" size={15} aria-hidden="true" />
        </summary>
        <div className="pw-mobile-nav__content">
          {showDashboard ? (
            <div className="pw-mobile-nav__group">
              <small>Start</small>
              <Link href={dashboard.href} aria-current={isItemActive(pathname, dashboard) ? "page" : undefined} onClick={closeMobileNav}>
                <LayoutDashboard size={16} aria-hidden="true" /><span>Pulpit</span>
              </Link>
            </div>
          ) : null}
          {groups.map((group) => (
            <Fragment key={group.key}>
              <div className="pw-mobile-nav__group">
                <small>{group.label}</small>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} prefetch={false} aria-current={isItemActive(pathname, item) ? "page" : undefined} onClick={closeMobileNav}>
                      <Icon size={16} aria-hidden="true" /><span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
              {group.key === "project" && showFinance ? (
                <div className="pw-mobile-nav__group pw-mobile-nav__group--direct">
                  <small>Finanse</small>
                  <Link href={finance.href} prefetch={false} aria-current={isItemActive(pathname, finance) ? "page" : undefined} onClick={closeMobileNav}>
                    <WalletCards size={16} aria-hidden="true" /><span>Finanse projektu</span>
                  </Link>
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      </details>

      <div className="project-navigation__desktop project-navigation__groups project-navigation__groups--rich" ref={desktopNavRef}>
        {showDashboard ? (
          <Link className="pw-nav-dashboard" href={dashboard.href} aria-current={isItemActive(pathname, dashboard) ? "page" : undefined}>
            <LayoutDashboard size={17} aria-hidden="true" /><span>Pulpit</span>
          </Link>
        ) : null}

        {groups.map((group) => {
          const currentItem = group.items.find((item) => isItemActive(pathname, item));
          const GroupIcon = group.icon;
          const open = openGroup === group.key;
          return (
            <Fragment key={group.key}>
              <div
                className={`pw-nav-group ${currentItem ? "is-active" : ""} ${open ? "is-open" : ""}`}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenGroup(null);
                }}
              >
                <button
                  type="button"
                  className="pw-nav-group__trigger"
                  aria-expanded={open}
                  aria-haspopup="menu"
                  onClick={() => setOpenGroup((current) => current === group.key ? null : group.key)}
                >
                  <GroupIcon size={17} aria-hidden="true" />
                  <span className="pw-nav-group__label"><strong>{group.label}</strong>{currentItem ? <small>{currentItem.label}</small> : null}</span>
                  <ChevronDown className="pw-nav-group__chevron" size={14} aria-hidden="true" />
                </button>
                <div className="pw-nav-group__menu" role="menu" aria-label={group.label} aria-hidden={!open}>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isItemActive(pathname, item);
                    return (
                      <Link key={item.href} href={item.href} prefetch={false} role="menuitem" tabIndex={open ? 0 : -1} aria-current={active ? "page" : undefined} onClick={() => setOpenGroup(null)}>
                        <Icon size={16} aria-hidden="true" /><span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>

              {group.key === "project" && showFinance ? (
                <Link className="pw-nav-dashboard pw-nav-finance" href={finance.href} prefetch={false} aria-current={isItemActive(pathname, finance) ? "page" : undefined}>
                  <WalletCards size={17} aria-hidden="true" /><span>Finanse</span>
                </Link>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
