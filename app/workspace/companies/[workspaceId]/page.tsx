import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Brain,
  Boxes,
  CarFront,
  ChartNoAxesCombined,
  FileStack,
  FolderKanban,
  Inbox,
  LayoutTemplate,
  LibraryBig,
  Search,
  Settings,
  UploadCloud,
  UsersRound,
  WalletCards
} from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type CompanyDashboardProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function CompanyDashboard({ params }: CompanyDashboardProps) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) {
    notFound();
  }

  const projects = await listProjectsForWorkspace(user, workspace.id);
  const supabase = createServiceSupabaseClient();
  const { count: documentCount } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);

  const activeProjects = projects.filter((project) => project.status === "active").length;
  const completedProjects = projects.filter((project) => project.status === "completed").length;
  const modules = [
    { label: "Inwestycje", description: "Dokumentacja, kosztorysy i prowadzenie realizacji", href: "investments", icon: FolderKanban },
    { label: "Finanse", description: "Budżety, koszty, przychody i cash flow", href: "finances", icon: WalletCards },
    { label: "Kadry", description: "Pracownicy, uprawnienia i przypisania", href: "hr", icon: UsersRound },
    { label: "Magazyn", description: "Materiały, sprzęt, stany i wydania", href: "warehouse", icon: Boxes },
    { label: "Flota", description: "Pojazdy, terminy, serwis, paliwo i koszty", href: "fleet", icon: CarFront },
    { label: "Dokumenty", description: "Centralny widok dokumentów całej firmy", href: "documents", icon: FileStack },
    { label: "Wzory", description: "Firmowe wzory i kontrolowane generatory dokumentów", href: "templates", icon: LayoutTemplate },
    { label: "Octopus Brain", description: "Analiza kontekstu firmy i inwestycji", href: "brain", icon: Brain },
    { label: "Skrzynka AI", description: "Decyzje, błędy i elementy wymagające zatwierdzenia", href: "ai-inbox", icon: Inbox },
    { label: "Wyszukiwarka", description: "Dokumenty, fakty i wiedza ze źródłami", href: "search", icon: Search },
    { label: "Pamięć firmy", description: "Lekcje, rozwiązania i ryzyka z realizacji", href: "knowledge", icon: LibraryBig },
    { label: "Raporty", description: "Analityka przedsiębiorstwa i inwestycji", href: "reports", icon: ChartNoAxesCombined },
    { label: "Ustawienia", description: "Dane firmy, role i konfiguracja", href: "settings", icon: Settings }
  ];

  return (
    <main className="co-page">
      <header className="co-page-heading">
        <div>
          <p className="co-kicker">Centrum przedsiębiorstwa</p>
          <h1>{workspace.name}</h1>
          <p>{workspace.industry || "Panel operacyjny Project Octopus"}</p>
        </div>
        <div className="co-company-address">
          <strong>{workspace.city || "Firma"}</strong>
          <span>{workspace.tax_id ? `NIP ${workspace.tax_id}` : "Uzupełnij dane w Ustawieniach"}</span>
          <Link href={`/workspace/companies/${workspace.id}/documents?upload=1`} className="co-primary-button"><UploadCloud size={17} aria-hidden="true" /> Wrzutnia</Link>
        </div>
      </header>

      <section className="co-metric-grid" aria-label="Podsumowanie firmy">
        <article className="co-metric-card">
          <span>Aktywne inwestycje</span>
          <strong>{activeProjects}</strong>
          <small>{projects.length} wszystkich inwestycji</small>
        </article>
        <article className="co-metric-card">
          <span>Dokumenty</span>
          <strong>{documentCount ?? 0}</strong>
          <small>aktywnych plików w firmie</small>
        </article>
        <article className="co-metric-card">
          <span>Zakończone</span>
          <strong>{completedProjects}</strong>
          <small>inwestycji</small>
        </article>
        <article className="co-metric-card co-metric-card--ai">
          <span>OctopusAI</span>
          <strong>Aktywny</strong>
          <small>kontekst tej firmy</small>
        </article>
      </section>

      <section className="co-section">
        <div className="co-section-heading">
          <div>
            <p className="co-kicker">Moduły firmy</p>
            <h2>Obszary pracy</h2>
          </div>
        </div>
        <div className="co-module-grid">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <Link href={`/workspace/companies/${workspace.id}/${module.href}`} className="co-module-card" key={module.href}>
                <span className="co-module-card__icon"><Icon size={21} aria-hidden="true" /></span>
                <div>
                  <h3>{module.label}</h3>
                  <p>{module.description}</p>
                </div>
                <span className="co-module-card__arrow">→</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="co-section">
        <div className="co-section-heading">
          <div>
            <p className="co-kicker">Ostatnie inwestycje</p>
            <h2>Aktualna działalność</h2>
          </div>
          <Link href={`/workspace/companies/${workspace.id}/investments`} className="co-text-link">Wszystkie inwestycje →</Link>
        </div>
        {projects.length ? (
          <div className="co-project-strip">
            {projects.slice(0, 4).map((project) => (
              <Link href={`/workspace/projects/${project.id}`} key={project.id}>
                <span>{project.status}</span>
                <strong>{project.name}</strong>
                <small>{project.location || project.investor_name || "Brak lokalizacji"}</small>
              </Link>
            ))}
          </div>
        ) : (
          <div className="co-empty-state">
            <strong>Nie ma jeszcze inwestycji.</strong>
            <p>Dodaj pierwszą inwestycję w module Inwestycje.</p>
          </div>
        )}
      </section>
    </main>
  );
}
