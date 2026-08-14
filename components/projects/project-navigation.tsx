"use client";

import Link from "next/link";
import {
  Archive,
  BarChart3,
  Brain,
  Calculator,
  CalendarDays,
  ChartNoAxesCombined,
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
import { ProjectIntake } from "@/components/projects/project-intake";
import type { Domain } from "@/lib/authorization";

type ProjectNavigationProps = {
  projectId: string;
  allowedDomains: Domain[];
  canUpload: boolean;
};

export function ProjectNavigation({ projectId, allowedDomains, canUpload }: ProjectNavigationProps) {
  const pathname = usePathname();
  const base = `/workspace/projects/${projectId}`;
  const items = [
    { href: base, label: "Dashboard", icon: LayoutDashboard, exact: true, domain: "investments" as const },
    { href: `${base}/control`, label: "Kontrola 360", icon: Gauge, domain: "investments" as const },
    { href: `${base}/data`, label: "Dane", icon: Database, domain: "investments" as const },
    { href: `${base}/documentation`, label: "Dokumentacja", icon: FileText, domain: "investments" as const },
    { href: `${base}/cost-estimate`, label: "Kosztorys", icon: Calculator, domain: "investments" as const },
    { href: `${base}/brain`, label: "Brain AI", icon: Brain, domain: "investments" as const },
    { href: `${base}/requests`, label: "Wnioski", icon: PackageCheck, domain: "investments" as const },
    { href: `${base}/protocols`, label: "Protokoły", icon: ClipboardCheck, domain: "investments" as const },
    { href: `${base}/schedule`, label: "Harmonogram", icon: CalendarDays, domain: "investments" as const },
    { href: `${base}/progress`, label: "Przerób", icon: BarChart3, domain: "investments" as const },
    { href: `${base}/finance`, label: "Finanse", icon: WalletCards, domain: "finance" as const },
    { href: `${base}/team`, label: "Zespół", icon: UsersRound, domain: "hr" as const },
    { href: `${base}/warehouse`, label: "Magazyn", icon: Warehouse, domain: "warehouse" as const },
    { href: `${base}/reports`, label: "Raporty", icon: ChartNoAxesCombined, domain: "reports" as const },
    { href: `${base}/site`, label: "Budowa", icon: Construction, domain: "investments" as const },
    { href: `${base}/closeout`, label: "Zamknięcie", icon: ShieldCheck, domain: "investments" as const },
    { href: `${base}/outputs`, label: "Wyniki", icon: Archive, domain: "investments" as const }
  ].filter((item) => allowedDomains.includes(item.domain));

  return (
    <nav className="project-navigation project-navigation--v2" aria-label="Menu inwestycji">
      <div className="project-navigation__items">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
              <Icon size={16} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>
      {canUpload ? <ProjectIntake projectId={projectId} /> : null}
    </nav>
  );
}
