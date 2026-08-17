import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookOpenCheck, CheckCircle2, CircleDashed, FileText, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { updateCompanyAction } from "@/app/actions";
import { AiInbox } from "@/components/brain/ai-inbox";
import { QueueHealthPanel } from "@/components/brain/queue-health-panel";
import { KnowledgeEntryForm } from "@/components/brain/knowledge-entry-form";
import { KnowledgeSearch } from "@/components/brain/knowledge-search";
import { CompanyOperationsWorkspace } from "@/components/company/company-operations-workspace";
import { DomainLivePanel } from "@/components/dashboard/domain-live-panel";
import { DocumentUpload } from "@/components/documents/document-upload";
import { TemplateStudio } from "@/components/templates/template-studio";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { requireCurrentUser } from "@/lib/auth";
import { domainAccessPolicyAllows, domainAccessPolicyHasAnyScope, domainForDocumentCategory, hasDomainAccess, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { isDocumentStorageSchemaReady, listDocumentsForWorkspace } from "@/lib/data/documents";
import {
  getFinanceWorkspaceData,
  getFleetWorkspaceData,
  getHrWorkspaceData,
  getReportsWorkspaceData,
  getWarehouseWorkspaceData
} from "@/lib/data/company-operations";
import { getProcessingQueueHealth, listAiInbox } from "@/lib/data/operations";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser, isCompanyProfileSchemaReady } from "@/lib/data/workspace";
import { getAiRuntimeStatus } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { DOCUMENT_DESTINATIONS } from "@/lib/documents/classification";
import { generationDocumentCategory } from "@/lib/templates/render-generation";

export const dynamic = "force-dynamic";

type CompanySectionPageProps = {
  params: Promise<{ workspaceId: string; section: string }>;
  searchParams: Promise<{ saved?: string }>;
};

const OPERATIONAL_MODULES = {
  finances: {
    domain: "finance" as const,
    kicker: "Finanse",
    title: "Finanse przedsiębiorstwa",
    description: "Faktury, rozrachunki, płatności i zobowiązania spięte z inwestycjami oraz cash flow firmy.",
    load: getFinanceWorkspaceData,
    kind: "finance" as const
  },
  hr: {
    domain: "hr" as const,
    kicker: "Kadry",
    title: "Kadry i zasoby ludzkie",
    description: "Kartoteka pracowników, warunki zatrudnienia, koszty, czas pracy, urlopy i uprawnienia.",
    load: getHrWorkspaceData,
    kind: "hr" as const
  },
  warehouse: {
    domain: "warehouse" as const,
    kicker: "Magazyn",
    title: "Magazyn i sprzęt",
    description: "Kartoteki, rzeczywiste stany oraz ruchy PZ, WZ, RW, ZW i MM powiązane z inwestycjami.",
    load: getWarehouseWorkspaceData,
    kind: "warehouse" as const
  },
  fleet: {
    domain: "fleet" as const,
    kicker: "Flota",
    title: "Flota i transport",
    description: "Pojazdy i maszyny, paliwo, serwis, przebiegi, dokumenty, terminy i koszty realizacji.",
    load: getFleetWorkspaceData,
    kind: "fleet" as const
  }
};

const SECTION_ACCESS: Partial<Record<string, { domain: Domain; label: string }>> = {
  investments: { domain: "investments", label: "Inwestycje" },
  finances: { domain: "finance", label: "Finanse" },
  hr: { domain: "hr", label: "Kadry" },
  warehouse: { domain: "warehouse", label: "Magazyn" },
  fleet: { domain: "fleet", label: "Flota" },
  search: { domain: "investments", label: "Wyszukiwarka" },
  reports: { domain: "reports", label: "Raporty" },
  settings: { domain: "settings", label: "Ustawienia" }
};

export default async function CompanySectionPage({ params, searchParams }: CompanySectionPageProps) {
  const { workspaceId, section } = await params;
  const query = await searchParams;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) {
    notFound();
  }
  const referenceDate = new Date().toISOString();

  if (["templates", "brain", "knowledge"].includes(section)) {
    redirect(`/workspace/companies/${workspace.id}/ai-center`);
  }

  const requiredAccess = SECTION_ACCESS[section];
  if (requiredAccess && !await hasDomainAccess({
    workspaceId: workspace.id,
    userId: user.id,
    domain: requiredAccess.domain,
    level: "read"
  })) {
    return <DomainAccessDenied workspaceId={workspace.id} area={requiredAccess.label} />;
  }

  if (section in OPERATIONAL_MODULES) {
    const moduleConfig = OPERATIONAL_MODULES[section as keyof typeof OPERATIONAL_MODULES];
    const [data, canWrite] = await Promise.all([
      moduleConfig.load(workspace.id),
      hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: moduleConfig.domain, level: "write" })
    ]);
    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">{moduleConfig.kicker}</p>
            <h1>{moduleConfig.title}</h1>
            <p>{moduleConfig.description}</p>
          </div>
        </header>
        <CompanyOperationsWorkspace workspaceId={workspace.id} kind={moduleConfig.kind} data={data} canWrite={canWrite} referenceDate={referenceDate} />
      </main>
    );
  }

  if (section === "documents") {
    const [projects, allDocumentSummaries, allTrashedDocuments, storageReady, accessPolicy] = await Promise.all([
      listProjectsForWorkspace(user, workspace.id),
      listDocumentsForWorkspace(workspace.id),
      listDocumentsForWorkspace(workspace.id, true),
      isDocumentStorageSchemaReady(),
      loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id })
    ]);
    const canReadDocument = (document: { category: string | null; project_id: string | null }) => domainAccessPolicyAllows(accessPolicy, {
      domain: domainForDocumentCategory(document.category), level: "read", projectId: document.project_id
    });
    const canReadAnyDocuments = (["investments", "finance", "hr", "warehouse", "fleet", "templates", "reports"] as Domain[]).some((domain) => domainAccessPolicyHasAnyScope(accessPolicy, { domain, level: "read" }));
    if (!canReadAnyDocuments) return <DomainAccessDenied workspaceId={workspace.id} area="Dokumenty" />;
    const documentSummaries = allDocumentSummaries.filter(canReadDocument);
    const documents = documentSummaries.slice(0, 100);
    const trashedDocuments = allTrashedDocuments.filter(canReadDocument);
    const visibleProjects = projects.filter((project) => domainAccessPolicyAllows(accessPolicy, { domain: "investments", level: "read", projectId: project.id }));
    const projectNames = new Map(visibleProjects.map((project) => [project.id, project.name]));
    const editableDocumentIds = [...documentSummaries, ...trashedDocuments].filter((document) => domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(document.category), level: "write", projectId: document.project_id })).map((document) => document.id);
    const allowedCategories = DOCUMENT_DESTINATIONS.filter((destination) => domainAccessPolicyHasAnyScope(accessPolicy, { domain: domainForDocumentCategory(destination.value), level: "write" })).map((destination) => destination.value);
    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">Dokumenty</p>
            <h1>Centralne dokumenty firmy</h1>
            <p>Jeden widok na pliki ze wszystkich inwestycji: umowy, faktury, dokumentację techniczną, protokoły i załączniki.</p>
          </div>
          <strong className="co-count-badge">{documents.length} plików</strong>
        </header>

        <section className="co-category-strip">
          {["Umowy", "Faktury", "Dokumentacja techniczna", "Protokoły", "Załączniki", "OCR / AI"].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </section>

        <section className="document-principles">
          <div><strong>1. Wrzucasz</strong><span>Plik trafia do prywatnego magazynu R2.</span></div>
          <div><strong>2. AI rozumie</strong><span>OCR, klasyfikacja, kontekst i fakty ze źródłami.</span></div>
          <div><strong>3. Zatwierdzasz</strong><span>Niepewne decyzje trafiają do Skrzynki AI.</span></div>
          <div><strong>4. System wykorzystuje</strong><span>Dokument zasila właściwą firmę, inwestycję i moduł.</span></div>
        </section>

        <DocumentUpload
          workspaceId={workspace.id}
          projects={visibleProjects}
          documents={documentSummaries}
          trashedDocuments={trashedDocuments}
          storageReady={storageReady}
          canUpload={allowedCategories.length > 0}
          allowedCategories={allowedCategories}
          editableDocumentIds={editableDocumentIds}
        />

        <section className="co-section">
          <div className="co-section-heading">
            <div>
              <p className="co-kicker">Biblioteka</p>
              <h2>Ostatnio aktualizowane</h2>
            </div>
          </div>
          {documents.length ? (
            <div className="co-document-table">
              {documents.map((document) => (
                <article key={document.id}>
                  <span className="co-document-icon"><FileText size={18} aria-hidden="true" /></span>
                  <div>
                    <strong>{document.name}</strong>
                    <small>{document.category || "Dokument"} · {document.project_id ? projectNames.get(document.project_id) ?? "Inwestycja" : "Dokument firmowy"}</small>
                  </div>
                  <time>{document.updated_at ? new Date(document.updated_at).toLocaleDateString("pl-PL") : ""}</time>
                  <Link href={document.project_id ? `/workspace/projects/${document.project_id}/documentation#document-${document.id}` : `/workspace/companies/${workspace.id}/documents#document-${document.id}`}>Otwórz →</Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="co-empty-state">
              <strong>Brak dokumentów w firmie.</strong>
              <p>Pliki dodane w inwestycjach będą automatycznie widoczne również tutaj.</p>
            </div>
          )}
        </section>
      </main>
    );
  }

  if (section === "reports") {
    const [data, canWrite] = await Promise.all([
      getReportsWorkspaceData(workspace.id),
      hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "reports", level: "write" })
    ]);

    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">Raporty</p>
            <h1>Raporty i analityka</h1>
            <p>Definicje cyklicznych raportów i zamknięte snapshoty danych finansowych, operacyjnych oraz zasobowych.</p>
          </div>
        </header>
        <CompanyOperationsWorkspace workspaceId={workspace.id} kind="reports" data={data} canWrite={canWrite} referenceDate={referenceDate} />
      </main>
    );
  }

  if (section === "ai-center") {
    const [projects, allDocuments, allTrashedDocuments, storageReady, accessPolicy] = await Promise.all([
      listProjectsForWorkspace(user, workspace.id),
      listDocumentsForWorkspace(workspace.id),
      listDocumentsForWorkspace(workspace.id, true),
      isDocumentStorageSchemaReady(),
      loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id })
    ]);
    const canReadAiCenter = (["investments", "templates", "reports"] as Domain[]).some((domain) =>
      domainAccessPolicyHasAnyScope(accessPolicy, { domain, level: "read" })
    );
    if (!canReadAiCenter) return <DomainAccessDenied workspaceId={workspace.id} area="Centrum AI" />;
    const canReadTemplates = domainAccessPolicyHasAnyScope(accessPolicy, { domain: "templates", level: "read" });
    const canWriteTemplates = domainAccessPolicyHasAnyScope(accessPolicy, { domain: "templates", level: "write" });
    const canReadReports = domainAccessPolicyHasAnyScope(accessPolicy, { domain: "reports", level: "read" });
    const canWriteReports = domainAccessPolicyHasAnyScope(accessPolicy, { domain: "reports", level: "write" });
    const visibleProjects = projects.filter((project) => domainAccessPolicyAllows(accessPolicy, { domain: "investments", level: "read", projectId: project.id }));
    const canReadDocument = (document: { category: string | null; project_id: string | null }) => domainAccessPolicyAllows(accessPolicy, {
      domain: domainForDocumentCategory(document.category), level: "read", projectId: document.project_id
    });
    const documents = allDocuments.filter(canReadDocument);
    const trashedDocuments = allTrashedDocuments.filter(canReadDocument);
    const editableDocumentIds = [...documents, ...trashedDocuments].filter((document) => domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(document.category), level: "write", projectId: document.project_id })).map((document) => document.id);
    const allowedCategories = DOCUMENT_DESTINATIONS.filter((destination) => domainAccessPolicyHasAnyScope(accessPolicy, { domain: domainForDocumentCategory(destination.value), level: "write" })).map((destination) => destination.value);
    const entries = canReadReports
      ? (await createServiceSupabaseClient().from("knowledge_entries").select("id,entry_type,title,summary,solution,tags,status,created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100)).data ?? []
      : [];
    const ai = getAiRuntimeStatus();
    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div><p className="co-kicker">Centrum AI</p><h1>Wzory, wiedza firmy i Octopus Brain</h1><p>Jedna kontrolowana baza materiałów, z których AI korzysta w każdej inwestycji do analizy, wyszukiwania i generowania dokumentów.</p></div>
          <strong className="co-count-badge">{ai.ready ? "AI aktywne" : "AI wymaga konfiguracji"}</strong>
        </header>
        <section className="ai-center-flow" aria-label="Obieg wiedzy AI">
          <article><Sparkles size={18} /><strong>1. Dodaj źródło</strong><span>Wzór, instrukcję, lekcję lub dokument referencyjny.</span></article>
          <article><Sparkles size={18} /><strong>2. AI analizuje</strong><span>Rozpoznaje kontekst, typ i możliwe zastosowania.</span></article>
          <article><CheckCircle2 size={18} /><strong>3. Człowiek zatwierdza</strong><span>Niepewne decyzje trafiają do Skrzynki AI.</span></article>
          <article><BookOpenCheck size={18} /><strong>4. Firma wykorzystuje</strong><span>Wiedza i wzory są dostępne w każdej inwestycji.</span></article>
        </section>
        <section className="co-section">
          <div className="co-section-heading"><div><p className="co-kicker">Materiały dla AI</p><h2>Wrzutnia i biblioteka źródeł</h2></div><strong>{documents.length} dokumentów</strong></div>
          <DocumentUpload workspaceId={workspace.id} projects={visibleProjects} documents={documents} trashedDocuments={trashedDocuments} storageReady={storageReady} defaultCategory={canWriteTemplates ? "template" : undefined} canUpload={allowedCategories.length > 0} allowedCategories={allowedCategories} editableDocumentIds={editableDocumentIds} />
        </section>
        {canReadTemplates ? <TemplateStudio workspaceId={workspace.id} /> : null}
        {canReadReports ? <section className="control-dashboard-grid ai-center-knowledge">
          <article className="module-panel"><div className="module-panel__heading"><BookOpenCheck size={20} /><div><p className="eyebrow">Pamięć firmy</p><h2>{canWriteReports ? "Dodaj sprawdzoną wiedzę" : "Pamięć tylko do odczytu"}</h2></div></div>{canWriteReports ? <KnowledgeEntryForm workspaceId={workspace.id} projects={visibleProjects.map((project) => ({ id: project.id, name: project.name }))} /> : <p>Dodawanie wpisów wymaga roli Raporty: zapis.</p>}</article>
          <article className="module-panel"><div className="module-panel__heading"><CheckCircle2 size={20} /><div><p className="eyebrow">Biblioteka wiedzy</p><h2>{entries.filter((item) => item.status === "approved").length} zatwierdzonych</h2></div></div><div className="knowledge-entry-list">{entries.map((entry) => <article key={entry.id}>{entry.status === "approved" ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />}<div><small>{entry.entry_type} · {entry.status}</small><strong>{entry.title}</strong><p>{entry.summary}</p><span>{Array.isArray(entry.tags) ? entry.tags.join(" · ") : ""}</span></div></article>)}{!entries.length ? <p className="empty-copy">Dodaj pierwszy wpis z wiedzą firmy.</p> : null}</div></article>
        </section> : null}
        <section className="co-section"><div className="co-section-heading"><div><p className="co-kicker">Octopus Brain</p><h2>Przeszukaj całą zatwierdzoną wiedzę</h2></div></div><KnowledgeSearch workspaceId={workspace.id} /></section>
      </main>
    );
  }

  if (section === "ai-inbox") {
    const [allItems, accessPolicy] = await Promise.all([
      listAiInbox(workspace.id),
      loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id })
    ]);
    const canReadInbox = (["investments", "templates", "reports"] as Domain[]).some((domain) => domainAccessPolicyHasAnyScope(accessPolicy, { domain, level: "read" }));
    if (!canReadInbox) return <DomainAccessDenied workspaceId={workspace.id} area="Skrzynka AI" />;
    const canReadQueueHealth = domainAccessPolicyHasAnyScope(accessPolicy, { domain: "settings", level: "read" });
    const canRunWorker = domainAccessPolicyHasAnyScope(accessPolicy, { domain: "settings", level: "admin" });
    const queueHealth = canReadQueueHealth ? await getProcessingQueueHealth(workspace.id) : null;
    const items = allItems.filter((item) => {
      if (item.entityType === "generation_run") return domainAccessPolicyAllows(accessPolicy, { domain: "templates", level: "read", projectId: item.projectId }) && domainAccessPolicyAllows(accessPolicy, { domain: "investments", level: "read", projectId: item.projectId }) && domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(generationDocumentCategory(item.category)), level: "read", projectId: item.projectId });
      const domain: Domain = item.entityType === "template_version"
        ? "templates"
        : item.entityType === "knowledge_entry"
          ? "reports"
          : item.entityType === "document"
            ? domainForDocumentCategory(item.category)
            : "investments";
      return domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId: item.projectId });
    });
    const reviewCount = items.filter((item) => item.status === "review").length;
    const errorCount = items.filter((item) => item.status === "error").length;
    return (
      <main className="co-page">
        <header className="co-page-heading"><div><p className="co-kicker">Wspólna kontrola AI</p><h1>Skrzynka AI</h1><p>Klasyfikacje, importy kosztorysów, skutki rewizji, szkice z budowy i wiedza firmy wymagające decyzji człowieka.</p></div><strong className="co-count-badge">{reviewCount} decyzji · {errorCount} błędów</strong></header>
        {queueHealth ? <QueueHealthPanel health={queueHealth} workspaceId={workspace.id} canRunWorker={canRunWorker} /> : null}
        <section className="co-section"><AiInbox items={items} workspaceId={workspace.id} /></section>
      </main>
    );
  }

  if (section === "search") {
    return (
      <main className="co-page">
        <header className="co-page-heading"><div><p className="co-kicker">Wyszukiwarka hybrydowa</p><h1>Wiedza firmy ze wskazaniem źródła</h1><p>Dokumenty, pełna treść, fakty Project DNA i zatwierdzona pamięć organizacji w jednym wyszukiwaniu.</p></div></header>
        <section className="co-section"><KnowledgeSearch workspaceId={workspace.id} /></section>
      </main>
    );
  }

  if (section === "settings") {
    const schemaReady = await isCompanyProfileSchemaReady();
    const updateAction = updateCompanyAction.bind(null, workspace.id);

    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">Ustawienia</p>
            <h1>Ustawienia firmy</h1>
            <p>Dane organizacji i fundament pod użytkowników, integracje oraz konfigurację OctopusAI.</p>
          </div>
          {query.saved === "1" ? <span className="co-saved-badge"><CheckCircle2 size={16} /> Zapisano</span> : null}
        </header>

        {!schemaReady ? <div className="co-schema-warning">Profil firmy wymaga zastosowania najnowszej migracji Supabase.</div> : null}

        <section className="co-section">
          <div className="co-section-heading"><div><p className="co-kicker">Dane podstawowe</p><h2>Profil przedsiębiorstwa</h2></div></div>
          <form action={updateAction} className="co-settings-form">
            <label className="co-field co-field--wide"><span>Nazwa firmy *</span><input name="name" defaultValue={workspace.name} required minLength={2} /></label>
            <label className="co-field"><span>NIP</span><input name="tax_id" defaultValue={workspace.tax_id ?? ""} /></label>
            <label className="co-field"><span>REGON</span><input name="regon" defaultValue={workspace.regon ?? ""} /></label>
            <label className="co-field co-field--wide"><span>Branża</span><input name="industry" defaultValue={workspace.industry ?? ""} /></label>
            <label className="co-field co-field--wide"><span>Ulica i numer</span><input name="street" defaultValue={workspace.street ?? ""} /></label>
            <label className="co-field"><span>Kod pocztowy</span><input name="postal_code" defaultValue={workspace.postal_code ?? ""} /></label>
            <label className="co-field"><span>Miasto</span><input name="city" defaultValue={workspace.city ?? ""} /></label>
            <label className="co-field"><span>E-mail</span><input name="email" type="email" defaultValue={workspace.email ?? ""} /></label>
            <label className="co-field"><span>Telefon</span><input name="phone" type="tel" defaultValue={workspace.phone ?? ""} /></label>
            <label className="co-field co-field--wide"><span>Osoba kontaktowa</span><input name="contact_person" defaultValue={workspace.contact_person ?? ""} /></label>
            <label className="co-field co-field--wide"><span>Notatka</span><textarea name="notes" rows={4} defaultValue={workspace.notes ?? ""} /></label>
            <div className="co-settings-form__actions"><button className="co-primary-button" type="submit" disabled={!schemaReady}>Zapisz dane firmy</button></div>
          </form>
        </section>

        <section className="co-settings-cards">
          <article><ShieldCheck size={21} /><div><strong>Użytkownicy i uprawnienia</strong><p>Role właściciela, administratora, członka i obserwatora pozostają przypisane do konkretnej firmy.</p></div></article>
          <article><SlidersHorizontal size={21} /><div><strong>Integracje</strong><p>Miejsce pod integracje firmowe, konfigurację OctopusAI i dalsze źródła danych.</p></div></article>
          <article><CheckCircle2 size={21} /><div><strong>Plan i konfiguracja systemu</strong><p>Obszar przygotowany pod ustawienia organizacji i przyszły model SaaS.</p></div></article>
        </section>
        <DomainLivePanel kind="settings" workspaceId={workspace.id} />
      </main>
    );
  }

  notFound();
}
