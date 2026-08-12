"use client";

import Link from "next/link";
import { Brain, ClipboardList, Database, FileText, LayoutDashboard } from "lucide-react";
import { usePathname } from "next/navigation";

type ProjectNavigationProps = {
  projectId: string;
};

export function ProjectNavigation({ projectId }: ProjectNavigationProps) {
  const pathname = usePathname();
  const base = `/workspace/projects/${projectId}`;
  const items = [
    { href: base, label: "Pulpit", icon: LayoutDashboard, exact: true },
    { href: `${base}/data`, label: "Dane inwestycji", icon: Database },
    { href: `${base}/documentation`, label: "Dokumentacja", icon: FileText },
    { href: `${base}/outputs`, label: "Wnioski i protokoły", icon: ClipboardList },
    { href: `${base}/brain`, label: "Octopus Brain", icon: Brain }
  ];

  return (
    <nav className="project-navigation" aria-label="Menu inwestycji">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            <Icon size={17} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
