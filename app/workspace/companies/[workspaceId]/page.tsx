import Link from "next/link";
import { notFound } from "next/navigation";
import { BrainCircuit, Boxes, CarFront, ChartNoAxesCombined, FileStack, FolderKanban, Inbox, Search, Settings, UploadCloud, UsersRound, WalletCards } from "lucide-react";
import { CompanyActionCenter } from "@/components/company/company-action-center";
import { requireCurrentUser } from "@/lib/auth";
import { domainAccessPolicyAllows, domainAccessPolicyHasAnyScope, domainForDocumentCategory, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { getCompanyActionCenter, refreshOperationalNotifications } from "@/lib/data/company-action-center";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getAiRuntimeStatus } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
type CompanyDashboardProps = { params: Promise<{ workspaceId: string }> };

function actionDomain(domain: string): Domain {
  if (domain === "finance" || domain === "hr" || domain === "warehouse" || domain === "fleet" || domain === "reports" || domain === "templates" || domain === "settings") return domain;
  return "investments";
}

export default async function CompanyDashboard({ params }: CompanyDashboardProps) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();
  const accessPolicy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const projects = (await listProjectsForWorkspace(user, workspace.id)).filter((project) => domainAccessPolicyAllows(accessPolicy, { domain: "investments", level: "read", projectId: project.id }));
  const supabase = createServiceSupabaseClient();
  const [documentResult, actionItems] = await Promise.all([
    supabase.from("documents").select("id,category,project_id").eq("workspace_id", workspace.id).is("deleted_at", null),
    getCompanyActionCenter(workspace.id, 100).catch(() => [])
  ]);
  await refreshOperationalNotifications(workspace.id).catch(() => null);
  const documentCount = (documentResult.data ?? []).filter((document) => domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(document.category), level: "read", projectId: document.project_id })).length;
  const visibleActions = actionItems.filter((item) => domainAccessPolicyAllows(accessPolicy, { domain: actionDomain(item.domain), level: "read", projectId: item.projectId }));
  const activeProjects = projects.filter((project) => project.status === "active").length;
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
  ].filter((module) => module.accessDomains ? module.accessDomains.some((domain) => domainAccessPolicyHasAnyScope(accessPolicy, { domain, level: "read" })) : module.domain === "investments" ? domainAccessPolicyHasAnyScope(accessPolicy, { domain: module.domain, level: "read" }) : domainAccessPolicyAllows(accessPolicy, { domain: module.domain, level: "read", projectId: null }));
  const aiReady = getAiRuntimeStatus().ready;
  const canUploadCompany = domainAccessPolicyAllows(accessPolicy, { domain: "investments", level: "write", projectId: null });
  return <main className="co-page">
    <header className="co-page-heading"><div><p className="co-kicker">Centrum przedsiębiorstwa</p><h1>{workspace.name}</h1><p>{workspace.industry || "Panel operacyjny Project Octopus"}</p></div><div className="co-company-address"><strong>{workspace.city || "Firma"}</strong><span>{workspace.tax_id ? `NIP ${workspace.tax_id}` : "Uzupełnij dane w Ustawieniach"}</span>{canUploadCompany ? <Link href={`/workspace/companies/${workspace.id}/documents?upload=1`} className="co-primary-button"><UploadCloud size={17} aria-hidden="true" /> Wrzutnia</Link> : null}</div></header>
    <section className="co-metric-grid" aria-label="Podsumowanie firmy"><article className="co-metric-card"><span>Aktywne inwestycje</span><strong>{activeProjects}</strong><small>{projects.length} wszystkich inwestycji</small></article><article className="co-metric-card"><span>Dokumenty</span><strong>{documentCount}</strong><small>aktywnych plików w firmie</small></article><article className="co-metric-card"><span>Wymaga uwagi</span><strong>{visibleActions.length}</strong><small>{visibleActions.filter((item) => item.severity === "critical").length} krytycznych wyjątków</small></article><article className="co-metric-card co-metric-card--ai"><span>OctopusAI</span><strong>{aiReady ? "Aktywny" : "Konfiguracja"}</strong><small>{aiReady ? "kontekst tej firmy" : "wymagany klucz Gemini"}</small></article></section>
    <CompanyActionCenter items={visibleActions} />
    <section className="co-section"><div className="co-section-heading"><div><p className="co-kicker">Moduły firmy</p><h2>Obszary pracy</h2></div></div><div className="co-module-grid">{modules.map((module) => { const Icon=module.icon; return <Link href={`/workspace/companies/${workspace.id}/${module.href}`} className="co-module-card" key={module.href}><span className="co-module-card__icon"><Icon size={21} aria-hidden="true" /></span><div><h3>{module.label}</h3><p>{module.description}</p></div><span className="co-module-card__arrow">→</span></Link>; })}</div></section>
    <section className="co-section"><div className="co-section-heading"><div><p className="co-kicker">Ostatnie inwestycje</p><h2>Aktualna działalność</h2></div><Link href={`/workspace/companies/${workspace.id}/investments`} className="co-text-link">Wszystkie inwestycje →</Link></div>{projects.length ? <div className="co-project-strip">{projects.slice(0,4).map((project)=><Link href={`/workspace/projects/${project.id}`} key={project.id}><span>{project.status}</span><strong>{project.name}</strong><small>{project.location || project.investor_name || "Brak lokalizacji"}</small></Link>)}</div> : <div className="co-empty-state"><strong>Nie ma jeszcze inwestycji.</strong><p>Dodaj pierwszą inwestycję w module Inwestycje.</p></div>}</section>
  </main>;
}
