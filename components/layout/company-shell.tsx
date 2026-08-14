"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Brain,
  Boxes,
  CarFront,
  ChartNoAxesCombined,
  FileStack,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  LibraryBig,
  LogOut,
  Search,
  Settings,
  UsersRound,
  WalletCards
} from "lucide-react";
import { OctopusAssistant } from "@/components/ai/octopus-assistant";
import type { Domain } from "@/lib/authorization";

type CompanyShellProps = {
  workspaceId: string;
  companyName: string;
  userEmail: string;
  allowedDomains: Domain[];
  children: React.ReactNode;
};

export function CompanyShell({ workspaceId, companyName, userEmail, allowedDomains, children }: CompanyShellProps) {
  const pathname = usePathname();
  const base = `/workspace/companies/${workspaceId}`;
  const items = [
    { href: base, label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: `${base}/investments`, label: "Inwestycje", icon: FolderKanban, projectRoutes: true, domain: "investments" as const },
    { href: `${base}/finances`, label: "Finanse", icon: WalletCards, domain: "finance" as const },
    { href: `${base}/hr`, label: "Kadry", icon: UsersRound, domain: "hr" as const },
    { href: `${base}/warehouse`, label: "Magazyn", icon: Boxes, domain: "warehouse" as const },
    { href: `${base}/fleet`, label: "Flota", icon: CarFront, domain: "fleet" as const },
    { href: `${base}/documents`, label: "Dokumenty", icon: FileStack, domain: "investments" as const },
    { href: `${base}/templates`, label: "Wzory", icon: LayoutTemplate, domain: "templates" as const },
    { href: `${base}/brain`, label: "Octopus Brain", icon: Brain, domain: "investments" as const },
    { href: `${base}/ai-inbox`, label: "Skrzynka AI", icon: Inbox, domain: "investments" as const },
    { href: `${base}/search`, label: "Wyszukiwarka", icon: Search, domain: "investments" as const },
    { href: `${base}/knowledge`, label: "Pamięć firmy", icon: LibraryBig, domain: "reports" as const },
    { href: `${base}/reports`, label: "Raporty", icon: ChartNoAxesCombined, domain: "reports" as const },
    { href: `${base}/settings`, label: "Ustawienia", icon: Settings, domain: "settings" as const }
  ].filter((item) => !item.domain || allowedDomains.includes(item.domain));

  return (
    <div className="co-shell">
      <aside className="co-sidebar">
        <Link href="/workspace" className="co-sidebar-brand">
          <strong>OCTOPUS</strong>
          <span>Project Octopus</span>
        </Link>

        <div className="co-company-switcher">
          <div className="co-company-switcher__topline">
            <small>Aktywna firma</small>
            <Link
              href="/workspace"
              className="co-company-switcher__change"
              aria-label="Zmień firmę"
              title="Zmień firmę"
            >
              <ArrowLeftRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <strong>{companyName}</strong>
        </div>

        <nav className="co-sidebar-nav" aria-label="Moduły firmy">
          {items.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href) || Boolean(item.projectRoutes && pathname.startsWith("/workspace/projects/"));
            const Icon = item.icon;

            return (
              <Link href={item.href} key={item.href} className={active ? "is-active" : undefined}>
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="co-sidebar-footer">
          <div>
            <small>Zalogowano jako</small>
            <span>{userEmail}</span>
          </div>
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="co-icon-button" aria-label="Wyloguj">
              <LogOut size={18} aria-hidden="true" />
            </button>
          </form>
        </div>
      </aside>

      <div className="co-main">{children}</div>
      <OctopusAssistant workspaceId={workspaceId} companyName={companyName} />
    </div>
  );
}
