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
  PackageCheck,
  ShieldCheck,
  UsersRound,
  WalletCards,
  Warehouse
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ProjectIntake } from "@/components/projects/project-intake";
import type { Domain } from "@/lib/authorization";

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
  const base = `/workspace/projects/${projectId}`;

  const dashboard: ProjectNavItem = {
    href: base,
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: true,
    domain: "investments"
  };

  const groups: ProjectNavGroup[] = [
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
  ]
    .map((group) => ({ ...group, items: group.items.filter((item) => allowedDomains.includes(item.domain)) }))
    .filter((group) => group.items.length > 0);

  const showDashboard = allowedDomains.includes(dashboard.domain);

  return (
    <nav className="project-navigation project-navigation--v3" aria-label="Menu inwestycji">
      <div className="project-navigation__groups">
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
          const activeItem = group.items.find((item) => isItemActive(pathname, item));
          const GroupIcon = group.icon;
          const open = openGroup === group.key;

          return (
            <div
              className={`pw-nav-group ${activeItem ? "is-active" : ""} ${open ? "is-open" : ""}`}
              key={group.key}
              onMouseEnter={() => setOpenGroup(group.key)}
              onMouseLeave={() => setOpenGroup((current) => current === group.key ? null : current)}
              onFocus={() => setOpenGroup(group.key)}
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
                  {activeItem ? <small>{activeItem.label}</small> : null}
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
