import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BrainCircuit,
  Boxes,
  CarFront,
  ChartNoAxesCombined,
  FileStack,
  FolderKanban,
  Inbox,
  Search,
  Settings,
  UploadCloud,
  UsersRound,
  WalletCards
} from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { listAiInbox } from "@/lib/data/operations";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainAccessPolicyAllows, domainAccessPolicyHasAnyScope, domainForDocumentCategory, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { getAiRuntimeStatus } from "@/lib/env";

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

  const accessPolicy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const projects = (await listProjectsForWorkspace(user, workspace.id)).filter((project) =>
    domainAccessPolicyAllows(accessPolicy, { domain: "investments", level: "read", projectId: project.id })
  );
  const supabase = createServiceSupabaseClient();
  const { data: documentRows } = await supabase
    .from("documents")
    .select("id,category,project_id")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);
  const documentCount = (documentRows ?? []).filter((document) => domainAccessPolicyAllows(accessPolicy, {
    domain: domainForDocumentCategory(document.category),
    level: "read",
    projectId: document.project_id
  })).length;

  const activeProjects = projects.filter((project) => project.status === "active").length;
  const completedProjects = projects.filter((project) => project.status === "completed").length;
  const modules = [
    { label: "Inwestycje", description: "Dokumentacja, kosztorysy i prowadzenie realizacji", href: "investments", icon: FolderKanban, domain: "investments" as Domain },
    { label: "Finanse", description: "Budżety, koszty, przychody i cash flow", href: "finances", icon: WalletCards, domain: "finance" as Domain },
    { label: "Kadry", description: "Pracownicy, uprawnienia i przypisania", href: "hr", icon: UsersRound, domain: "hr" as Domain },
    { label: "Magazyn", description: "Materiały, sprzęt, stany i wydania", href: "warehouse", icon: Boxes, domain: "warehouse" as Domain },
    { label: "Flota", description: "Pojazdy, terminy, serwis, paliwo i koszty", href: "fleet", icon: CarFront, domain: "fleet" as Domain },
    { label: "Dokumenty", description: "Centralny widok dokumentów całej firmy", href: "documents", icon: FileStack, domain: "investments" as Domain },
    { label: "Centrum AI", description: "Wzory, wiedza firmy i analiza Octopus Brain w jednym miejscu", href: "ai-center", icon: BrainCircuit, domain: "investments" as Domain, accessDomains: ["investments", "templates", "reports"] as Domain[] },
    { label: "Skrzynka AI", description: "Decyzje, błędy i elementy wymagające zatwierdzenia", href: "ai-inbox", icon: Inbox, domain: "investments" as Domain },
    { label: "Wyszukiwarka", description: "Dokumenty, fakty i wiedza ze źródłami", href: "search", icon: Search, domain: "investments" as Domain },
    { label: "Raporty", description: "Analityka przedsiębiorstwa i inwestycji", href: "reports", icon: ChartNoAxesCombined, domain: "reports" as Domain },
    { label: "Ustawienia", description: "Dane firmy, role i konfiguracja", href: "settings", icon: Settings, domain: "settings" as Domain }
  ].filter((module) => module.accessDomains
    ? module.accessDomains.some((domain) => domainAccessPolicyHasAnyScope(accessPolicy, { domain, level: "read" }))
    : module.domain === "investments"
      ? domainAccessPolicyHasAnyScope(accessPolicy, { domain: module.domain, level: "read" })
      : domainAccessPolicyAllows(accessPolicy, { domain: module.domain, level: "read", projectId: null }));
  const aiReady = getAiRuntimeStatus().ready;
  const canUploadCompany = domainAccessPolicyAllows(accessPolicy, { domain: "investments", level: "write", projectId: null });

  const financeRead = domainAccessPolicyAllows(accessPolicy, { domain: "finance", level: "read", projectId: null });
  const hrRead = domainAccessPolicyAllows(accessPolicy, { domain: "hr", level: "read", projectId: null });
  const fleetRead = domainAccessPolicyAllows(accessPolicy, { domain: "fleet", level: "read", projectId: null });
  const settingsRead = domainAccessPolicyAllows(accessPolicy, { domain: "settings", level: "read", projectId: null });
  const today = new Date().toISOString().slice(0, 10);
  const in14Days = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const [aiInbox, commitmentsResult, qualificationsResult, examsResult, fleetDocumentsResult, notificationsResult] = await Promise.all([
    domainAccessPolicyHasAnyScope(accessPolicy, { domain: "investments", level: "read" })
      ? listAiInbox(workspace.id).catch(() => [])
      : Promise.resolve([]),
    financeRead
      ? supabase.from("commitments").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).in("status", ["open", "approved"]).gte("expected_date", today).lte("expected_date", in14Days)
      : Promise.resolve({ count: 0, error: null }),
    hrRead
      ? supabase.from("qualifications").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).gte("valid_until", today).lte("valid_until", in30Days)
      : Promise.resolve({ count: 0, error: null }),
    hrRead
      ? supabase.from("medical_exams").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).gte("valid_until", today).lte("valid_until", in30Days)
      : Promise.resolve({ count: 0, error: null }),
    fleetRead
      ? supabase.from("vehicle_documents").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).gte("valid_until", today).lte("valid_until", in30Days)
      : Promise.resolve({ count: 0, error: null }),
    settingsRead
      ? supabase.from("notifications").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).is("read_at", null)
      : Promise.resolve({ count: 0, error: null })
  ]);

  const visibleAiItems = aiInbox.filter((item) => {
    const domain: Domain = item.entityType === "template_version"
      ? "templates"
      : item.entityType === "knowledge_entry"
        ? "reports"
        : item.entityType === "document"
          ? domainForDocumentCategory(item.category)
          : "investments";
    return domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId: item.projectId });
  });
  const aiDecisions = visibleAiItems.filter((item) => ["review", "error"].includes(item.status)).length;
  const hrDeadlines = Number(qualificationsResult.count ?? 0) + Number(examsResult.count ?? 0);
  const attentionItems = [
    {
      show: domainAccessPolicyHasAnyScope(accessPolicy, { domain: "investments", level: "read" }),
      href: "ai-inbox",
      label: "Decyzje i błędy AI",
      value: aiDecisions,
      detail: aiDecisions ? "Wymagają weryfikacji człowieka" : "Brak decyzji wymagających uwagi"
    },
    {
      show: financeRead,
      href: "finances",
      label: "Zobowiązania do 14 dni",
      value: Number(commitmentsResult.count ?? 0),
      detail: "Otwarte i zatwierdzone płatności"
    },
    {
      show: hrRead,
      href: "hr",
      label: "Terminy HR do 30 dni",
      value: hrDeadlines,
      detail: "Uprawnienia i badania medyczne"
    },
    {
      show: fleetRead,
      href: "fleet",
      label: "Terminy floty do 30 dni",
      value: Number(fleetDocumentsResult.count ?? 0),
      detail: "Dokumenty pojazdów i maszyn"
    },
    {
      show: settingsRead,
      href: "settings#security-automation",
      label: "Nieprzeczytane alerty",
      value: Number(notificationsResult.count ?? 0),
      detail: "Automatyzacje i wyjątki systemowe"
    }
  ].filter((item) => item.show);

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
          {canUploadCompany ? <Link href={`/workspace/companies/${workspace.id}/documents?upload=1`} className="co-primary-button"><UploadCloud size={17} aria-hidden="true" /> Wrzutnia</Link> : null}
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
          <strong>{documentCount}</strong>
          <small>aktywnych plików w firmie</small>
        </article>
        <article className="co-metric-card">
          <span>Zakończone</span>
          <strong>{completedProjects}</strong>
          <small>inwestycji</small>
        </article>
        <article className="co-metric-card co-metric-card--ai">
          <span>OctopusAI</span>
          <strong>{aiReady ? "Aktywny" : "Konfiguracja"}</strong>
          <small>{aiReady ? "kontekst tej firmy" : "wymagany klucz Gemini"}</small>
        </article>
      </section>

      {attentionItems.length ? (
        <section className="co-section">
          <div className="co-section-heading">
            <div>
              <p className="co-kicker">Do zrobienia teraz</p>
              <h2>Decyzje, terminy i wyjątki wymagające uwagi</h2>
            </div>
          </div>
          <div className="co-project-strip">
            {attentionItems.map((item) => (
              <Link href={`/workspace/companies/${workspace.id}/${item.href}`} key={item.href}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

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
