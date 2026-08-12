"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Boxes,
  ChartNoAxesCombined,
  FileStack,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Settings,
  UsersRound,
  WalletCards
} from "lucide-react";
import { OctopusAssistant } from "@/components/ai/octopus-assistant";

type CompanyShellProps = {
  workspaceId: string;
  companyName: string;
  userEmail: string;
  children: React.ReactNode;
};

export function CompanyShell({ workspaceId, companyName, userEmail, children }: CompanyShellProps) {
  const pathname = usePathname();
  const base = `/workspace/companies/${workspaceId}`;
  const items = [
    { href: base, label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: `${base}/investments`, label: "Inwestycje", icon: FolderKanban, projectRoutes: true },
    { href: `${base}/finances`, label: "Finanse", icon: WalletCards },
    { href: `${base}/hr`, label: "Kadry", icon: UsersRound },
    { href: `${base}/warehouse`, label: "Magazyn", icon: Boxes },
    { href: `${base}/documents`, label: "Dokumenty", icon: FileStack },
    { href: `${base}/reports`, label: "Raporty", icon: ChartNoAxesCombined },
    { href: `${base}/settings`, label: "Ustawienia", icon: Settings }
  ];

  return (
    <div className="co-shell">
      <aside className="co-sidebar">
        <Link href="/workspace" className="co-sidebar-brand">
          <strong>OCTOPUS</strong>
          <span>Project Octopus</span>
        </Link>

        <div className="co-company-switcher">
          <small>Aktywna firma</small>
          <strong>{companyName}</strong>
          <Link href="/workspace"><ArrowLeftRight size={15} aria-hidden="true" /> Zmień firmę</Link>
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
