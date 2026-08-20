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
  MoreHorizontal,
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

type ProjectNavigationProps = { projectId: string; allowedDomains: Domain[]; canUpload: boolean };
type ProjectNavItem = { href: string; label: string; icon: typeof LayoutDashboard; domain: Domain; exact?: boolean };
type ProjectNavGroup = { key: string; label: string; icon: typeof LayoutDashboard; items: ProjectNavItem[] };

function isItemActive(pathname: string, item: ProjectNavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function ProjectNavigation({ projectId, allowedDomains, canUpload }: ProjectNavigationProps) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const mobileNavRef = useRef<HTMLDetailsElement>(null);
  const base = `/workspace/projects/${projectId}`;

  const dashboard: ProjectNavItem = { href: base, label: "Pulpit", icon: LayoutDashboard, exact: true, domain: "investments" };
  const finance: ProjectNavItem = { href: `${base}/finance`, label: "Koszty", icon: WalletCards, domain: "finance" };
  const documentation: ProjectNavItem = { href: `${base}/documentation`, label: "Dokumenty", icon: FileText, domain: "investments" };

  const plan: ProjectNavGroup = {
    key: "plan", label: "Plan", icon: CalendarDays,
    items: [
      { href: `${base}/cost-estimate`, label: "Kosztorys / BOQ", icon: Calculator, domain: "investments" },
      { href: `${base}/schedule`, label: "Harmonogram", icon: CalendarDays, domain: "investments" }
    ]
  };

  const execution: ProjectNavGroup = {
    key: "execution", label: "Realizacja", icon: Construction,
    items: [
      { href: `${base}/site`, label: "Budowa / dziennik", icon: Construction, domain: "investments" },
      { href: `${base}/progress`, label: "Przerób", icon: BarChart3, domain: "investments" },
      { href: `${base}/requests`, label: "Wnioski materiałowe", icon: PackageCheck, domain: "investments" },
      { href: `${base}/protocols`, label: "Protokoły i odbiory", icon: ClipboardCheck, domain: "investments" }
    ]
  };

  const more: ProjectNavGroup = {
    key: "more", label: "Więcej", icon: MoreHorizontal,
    items: [
      { href: `${base}/data`, label: "Dane inwestycji", icon: Database, domain: "investments" },
      { href: `${base}/brain`, label: "Brain AI", icon: Brain, domain: "investments" },
      { href: `${base}/team`, label: "Zespół", icon: UsersRound, domain: "hr" },
      { href: `${base}/warehouse`, label: "Magazyn", icon: Warehouse, domain: "warehouse" },
      { href: `${base}/control`, label: "Kontrola 360", icon: Gauge, domain: "investments" },
      { href: `${base}/reports`, label: "Raporty", icon: ChartNoAxesCombined, domain: "reports" },
      { href: `${base}/closeout`, label: "Zamknięcie inwestycji", icon: ShieldCheck, domain: "investments" },
      { href: `${base}/outputs`, label: "Wyniki i archiwum", icon: Archive, domain: "investments" }
    ]
  };

  const filterGroup = (group: ProjectNavGroup): ProjectNavGroup => ({ ...group, items: group.items.filter((item) => allowedDomains.includes(item.domain)) });
  const groups = [filterGroup(plan), filterGroup(execution), filterGroup(more)].filter((group) => group.items.length > 0);
  const showDashboard = allowedDomains.includes(dashboard.domain);
  const showFinance = allowedDomains.includes(finance.domain);
  const showDocumentation = allowedDomains.includes(documentation.domain);
  const allItems = [
    ...(showDashboard ? [dashboard] : []),
    ...groups.flatMap((group) => group.items),
    ...(showFinance ? [finance] : []),
    ...(showDocumentation ? [documentation] : [])
  ];
  const activeItem = allItems.find((item) => isItemActive(pathname, item));

  const closeMobileNav = () => mobileNavRef.current?.removeAttribute("open");

  const directLink = (item: ProjectNavItem, className = "pw-nav-dashboard") => {
    const Icon = item.icon;
    const active = isItemActive(pathname, item);
    return <Link className={className} href={item.href} aria-current={active ? "page" : undefined}><Icon size={16} aria-hidden="true" /><span>{item.label}</span></Link>;
  };

  const desktopGroup = (group: ProjectNavGroup) => {
    const currentItem = group.items.find((item) => isItemActive(pathname, item));
    const GroupIcon = group.icon;
    const open = openGroup === group.key;
    return (
      <div className={`pw-nav-group ${currentItem ? "is-active" : ""} ${open ? "is-open" : ""}`} key={group.key}
        onFocus={() => setOpenGroup(group.key)}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenGroup(null); }}>
        <button type="button" className="pw-nav-group__trigger" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpenGroup((current) => current === group.key ? null : group.key)}>
          <GroupIcon size={16} aria-hidden="true" />
          <span className="pw-nav-group__label"><strong>{group.label}</strong>{currentItem ? <small>{currentItem.label}</small> : null}</span>
          <ChevronDown className="pw-nav-group__chevron" size={13} aria-hidden="true" />
        </button>
        <div className="pw-nav-group__menu" role="menu" aria-label={group.label}>
          {group.items.map((item) => { const Icon=item.icon; const active=isItemActive(pathname,item); return <Link key={item.href} href={item.href} prefetch={false} role="menuitem" aria-current={active ? "page" : undefined} onClick={() => setOpenGroup(null)}><Icon size={15} aria-hidden="true" /><span>{item.label}</span></Link>; })}
        </div>
      </div>
    );
  };

  return (
    <nav className="project-navigation project-navigation--v4" aria-label="Menu inwestycji">
      <details className="pw-mobile-nav" ref={mobileNavRef}>
        <summary><Menu size={17} aria-hidden="true" /><span><small>Menu inwestycji</small><strong>{activeItem?.label ?? "Wybierz sekcję"}</strong></span><ChevronDown className="pw-mobile-nav__chevron" size={15} aria-hidden="true" /></summary>
        <div className="pw-mobile-nav__content">
          {showDashboard ? <div className="pw-mobile-nav__group"><small>Start</small><Link href={dashboard.href} aria-current={isItemActive(pathname,dashboard)?"page":undefined} onClick={closeMobileNav}><LayoutDashboard size={16}/><span>Pulpit</span></Link></div> : null}
          {groups.filter((group)=>group.key!=="more").map((group)=><div className="pw-mobile-nav__group" key={group.key}><small>{group.label}</small>{group.items.map((item)=>{const Icon=item.icon;return <Link key={item.href} href={item.href} prefetch={false} aria-current={isItemActive(pathname,item)?"page":undefined} onClick={closeMobileNav}><Icon size={16}/><span>{item.label}</span></Link>;})}</div>)}
          {(showFinance || showDocumentation) ? <div className="pw-mobile-nav__group"><small>Kontrola</small>{showFinance?<Link href={finance.href} aria-current={isItemActive(pathname,finance)?"page":undefined} onClick={closeMobileNav}><WalletCards size={16}/><span>Koszty</span></Link>:null}{showDocumentation?<Link href={documentation.href} aria-current={isItemActive(pathname,documentation)?"page":undefined} onClick={closeMobileNav}><FileText size={16}/><span>Dokumenty</span></Link>:null}</div>:null}
          {groups.filter((group)=>group.key==="more").map((group)=><div className="pw-mobile-nav__group" key={group.key}><small>Więcej</small>{group.items.map((item)=>{const Icon=item.icon;return <Link key={item.href} href={item.href} prefetch={false} aria-current={isItemActive(pathname,item)?"page":undefined} onClick={closeMobileNav}><Icon size={16}/><span>{item.label}</span></Link>;})}</div>)}
        </div>
      </details>

      <div className="project-navigation__desktop project-navigation__groups project-navigation__groups--simplified">
        {showDashboard ? directLink(dashboard) : null}
        {groups.find((group)=>group.key==="plan") ? desktopGroup(groups.find((group)=>group.key==="plan")!) : null}
        {groups.find((group)=>group.key==="execution") ? desktopGroup(groups.find((group)=>group.key==="execution")!) : null}
        {showFinance ? directLink(finance, "pw-nav-dashboard pw-nav-direct") : null}
        {showDocumentation ? directLink(documentation, "pw-nav-dashboard pw-nav-direct") : null}
        {groups.find((group)=>group.key==="more") ? desktopGroup(groups.find((group)=>group.key==="more")!) : null}
      </div>

      {canUpload ? <ProjectIntake projectId={projectId} /> : null}
    </nav>
  );
}
