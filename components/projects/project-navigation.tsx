"use client";

import Link from "next/link";
import {
  Archive,
  BarChart3,
  Brain,
  Calculator,
  CalendarDays,
  ClipboardCheck,
  Database,
  FileText,
  LayoutDashboard,
  PackageCheck
} from "lucide-react";
import { usePathname } from "next/navigation";

type ProjectNavigationProps = {
  projectId: string;
};

export function ProjectNavigation({ projectId }: ProjectNavigationProps) {
  const pathname = usePathname();
  const base = `/workspace/projects/${projectId}`;
  const items = [
    { href: base, label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: `${base}/data`, label: "Dane", icon: Database },
    { href: `${base}/documentation`, label: "Dokumentacja", icon: FileText },
    { href: `${base}/cost-estimate`, label: "Kosztorys", icon: Calculator },
    { href: `${base}/brain`, label: "Brain AI", icon: Brain },
    { href: `${base}/requests`, label: "Wnioski", icon: PackageCheck },
    { href: `${base}/protocols`, label: "Protokoły", icon: ClipboardCheck },
    { href: `${base}/schedule`, label: "Harmonogram", icon: CalendarDays },
    { href: `${base}/progress`, label: "Przerób", icon: BarChart3 },
    { href: `${base}/outputs`, label: "Wyniki", icon: Archive }
  ];

  return (
    <nav className="project-navigation project-navigation--v2" aria-label="Menu inwestycji">
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
    </nav>
  );
}
