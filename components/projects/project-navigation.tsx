"use client";

import dynamic from "next/dynamic";
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
  Menu,
  PackageCheck,
  ShieldCheck,
  UsersRound,
  WalletCards,
  Warehouse
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import type { Domain } from "@/lib/authorization";

const ProjectIntake = dynamic(
  () => import("@/components/projects/project-intake-pipeline").then((module) => module.ProjectIntake),
  { ssr: false, loading: () => <span className="pw-intake-placeholder" aria-hidden="true" /> }
);

type ProjectNavigationProps = {
  projectId: string;
  allowedDomains: Domain[];
  canUpload: boolean;
};

type ProjectNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  domain: Domain;
  exact?: boolean;
};

type ProjectNavGroup = {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
  items: ProjectNavItem[];
};

function isItemActive(pathname: string, item: ProjectNavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function ProjectNavigation({ projectId, allowedDomains, canUpload }: ProjectNavigationProps) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const mobileNavRef = useRef<HTMLDetailsElement>(null);
  const base = `/workspace/projects/${projectId}`;

  const dashboard: ProjectNavItem = {
    href: base,
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: true,
    domain: "investments"
  };

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
      key: "plan",
      label: "Plan",
      icon: CalendarDays,
      items: [
        { href: `${base}/cost-estimate`, label: "Kosztorys / BOQ", icon: Calculator, domain: "investments" },
        { href: `${base}/schedule`, label: "Harmonogram", icon: CalendarDays, domain: "investments" }
      ]
    },
    {
      key: "execution",
      label: "Realizacja",
      icon: Construction,
      items: [
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
        { href: `${base}/warehouse`, label: "Magazyn", icon: Warehouse, domain: "warehouse" },
        { href: `${base}/finance`, label: "Finanse", icon: WalletCards, domain: "finance" }
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

  const groups: ProjectNavGroup[] = navigationGroups
    .map((group): ProjectNavGroup => ({
      ...group,
      items: group.items.filter((item) => allowedDomains.includes(item.domain))
    }))
    .filter((group) => group.items.length > 0);

  const showDashboard = allowedDomains.includes(dashboard.domain);
  const activeItem = showDashboard && isItemActive(pathname, dashboard)
    ? dashboard
    : groups.flatMap((group) => group.items).find((item) => isItemActive(pathname, item));

  const closeMobileNav = () => {
    mobileNavRef.current?.removeAttribute("open");
  };

  return (
    <nav className="project-navigation project-navigation--v3" aria-label="Menu inwestycji">
      <details className="pw-mobile-nav" ref={mobileNavRef}>
        <summary>
          <Menu size={17} aria-hidden="true" />
          <span>
            <small>Menu inwestycji</small>
            <strong>{activeItem?.label ?? "Wybierz sekcję"}</strong>
          </span>
          <ChevronDown className="pw-mobile-nav__chevron" size={15} aria-hidden="true" />
        </summary>
        <div className="pw-mobile-nav__content">
          {showDashboard ? (
            <div className="pw-mobile-nav__group">
              <small>Start</small>
              <Link href={dashboard.href} aria-current={isItemActive(pathname, dashboard) ? "page" : undefined} onClick={closeMobileNav}>
                <LayoutDashboard size={16} aria-hidden="true" />
                <span>Dashboard</span>
              </Link>
            </div>
          ) : null}
          {groups.map((group) => (
            <div className="pw-mobile-nav__group" key={group.key}>
              <small>{group.label}</small>
              {group.items.map((item) => {
                const active = isItemActive(pathname, item);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} prefetch={false} aria-current={active ? "page" : undefined} onClick={closeMobileNav}>
                    <Icon size={16} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </details>

      <div className="project-navigation__desktop project-navigation__groups">
        {showDashboard ? (
          <Link
            className="pw-nav-dashboard"
            href={dashboard.href}
            aria-current={isItemActive(pathname, dashboard) ? "page" : undefined}
          >
            <LayoutDashboard size={16} aria-hidden="true" />
            <span>Dashboard</span>
          </Link>
        ) : null}

        {groups.map((group) => {
          const currentItem = group.items.find((item) => isItemActive(pathname, item));
          const GroupIcon = group.icon;
          const open = openGroup === group.key;

          return (
            <div
              className={`pw-nav-group ${currentItem ? "is-active" : ""} ${open ? "is-open" : ""}`}
              key={group.key}
              onFocus={() => setOpenGroup(group.key)}
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
                <GroupIcon size={16} aria-hidden="true" />
                <span className="pw-nav-group__label">
                  <strong>{group.label}</strong>
                  {currentItem ? <small>{currentItem.label}</small> : null}
                </span>
                <ChevronDown className="pw-nav-group__chevron" size={13} aria-hidden="true" />
              </button>

              <div className="pw-nav-group__menu" role="menu" aria-label={group.label}>
                {group.items.map((item) => {
                  const active = isItemActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      role="menuitem"
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpenGroup(null)}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {canUpload ? <ProjectIntake projectId={projectId} /> : null}
    </nav>
  );
}
