import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpenCheck, Brain, CheckCircle2, CircleDashed, FileText, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { updateCompanyAction } from "@/app/actions";
import { AiInbox } from "@/components/brain/ai-inbox";
import { KnowledgeEntryForm } from "@/components/brain/knowledge-entry-form";
import { KnowledgeSearch } from "@/components/brain/knowledge-search";
import { DomainLivePanel } from "@/components/dashboard/domain-live-panel";
import { DocumentUpload } from "@/components/documents/document-upload";
import { TemplateStudio } from "@/components/templates/template-studio";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { requireCurrentUser } from "@/lib/auth";
import { domainAccessPolicyAllows, domainForDocumentCategory, hasDomainAccess, loadDomainAccessPolicy, type Domain } from "@/lib/authorization";
import { isDocumentStorageSchemaReady, listDocumentsForWorkspace } from "@/lib/data/documents";
import { listAiInbox } from "@/lib/data/operations";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser, isCompanyProfileSchemaReady } from "@/lib/data/workspace";
import { getAiRuntimeStatus } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type CompanySectionPageProps = {
  params: Promise<{ workspaceId: string; section: string }>;
  searchParams: Promise<{ saved?: string }>;
};

type DocumentRow = {
  id: string;
  name: string;
  category: string | null;
  project_id: string | null;
  updated_at: string;
  projects: { name: string } | { name: string }[] | null;
};

const MODULES: Record<string, { title: string; kicker: string; description: string; features: string[] }> = {
  finances: {
    kicker: "Finanse",
    title: "Finanse przedsiębiorstwa",
    description: "Warstwa przygotowana pod pełne rozliczenie firmy i poszczególnych inwestycji.",
    features: ["Budżety inwestycji", "Koszty i przychody", "Cash flow", "Należności i zobowiązania", "Kosztorys vs koszty rzeczywiste", "Rentowność realizacji"]
  },
  hr: {
    kicker: "Kadry",
    title: "Kadry i zasoby ludzkie",
    description: "Jedno miejsce do obsługi zespołu i przypisywania ludzi do realizacji.",
    features: ["Lista pracowników", "Role i uprawnienia", "Badania, szkolenia i uprawnienia", "Czas pracy", "Przypisanie do inwestycji", "Sprzęt powierzony"]
  },
  warehouse: {
    kicker: "Magazyn",
    title: "Magazyn i sprzęt",
    description: "Struktura pod materiały, urządzenia, narzędzia oraz ich ruch pomiędzy firmą i inwestycjami.",
    features: ["Stany magazynowe", "Przyjęcia i wydania", "Rezerwacje pod inwestycje", "Sprzęt i narzędzia", "Stany minimalne", "Inwentaryzacja"]
  },
  fleet: {
    kicker: "Flota",
    title: "Flota i transport",
    description: "Kontrola samochodów, ciężarówek, maszyn, kosztów i terminów eksploatacyjnych.",
    features: ["Ewidencja pojazdów", "OC, badania i leasing", "Serwis i przestoje", "Szkody i dokumentacja", "Paliwo i przebiegi", "Koszt floty na inwestycję"]
  }
};

const LIVE_KINDS = {
  finances: "finance",
  hr: "hr",
  warehouse: "warehouse",
  fleet: "fleet"
} as const;

const SECTION_ACCESS: Partial<Record<string, { domain: Domain; label: string }>> = {
  investments: { domain: "investments", label: "Inwestycje" },
  finances: { domain: "finance", label: "Finanse" },
  hr: { domain: "hr", label: "Kadry" },
  warehouse: { domain: "warehouse", label: "Magazyn" },
  fleet: { domain: "fleet", label: "Flota" },
  documents: { domain: "investments", label: "Dokumenty" },
  templates: { domain: "templates", label: "Wzory" },
  brain: { domain: "investments", label: "Octopus Brain" },
  "ai-inbox": { domain: "investments", label: "Skrzynka AI" },
  search: { domain: "investments", label: "Wyszukiwarka" },
  knowledge: { domain: "reports", label: "Pamięć firmy" },
  reports: { domain: "reports", label: "Raporty" },
  settings: { domain: "settings", label: "Ustawienia" }
};

function projectName(document: DocumentRow) {
  if (Array.isArray(document.projects)) {
    return document.projects[0]?.name ?? "Inwestycja";
  }
  return document.projects?.name ?? "Inwestycja";
}

export default async function CompanySectionPage({ params, searchParams }: CompanySectionPageProps) {
  const { workspaceId, section } = await params;
  const query = await searchParams;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) {
    notFound();
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

  if (MODULES[section]) {
    const moduleConfig = MODULES[section];
    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">{moduleConfig.kicker}</p>
            <h1>{moduleConfig.title}</h1>
            <p>{moduleConfig.description}</p>
          </div>
        </header>
        <section className="co-section">
          <div className="co-feature-grid">
            {moduleConfig.features.map((feature, index) => (
              <article className="co-feature-card" key={feature}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h2>{feature}</h2>
                <p>Zakres funkcjonalny modułu {moduleConfig.kicker.toLowerCase()}; bieżące dane i stan uruchomienia są widoczne poniżej.</p>
              </article>
            ))}
          </div>
        </section>
        <DomainLivePanel kind={LIVE_KINDS[section as keyof typeof LIVE_KINDS]} workspaceId={workspace.id} />
      </main>
    );
  }

  if (section === "documents") {
    const supabase = createServiceSupabaseClient();
    const [projects, allDocumentSummaries, allTrashedDocuments, storageReady, accessPolicy] = await Promise.all([
      listProjectsForWorkspace(user, workspace.id),
      listDocumentsForWorkspace(workspace.id),
      listDocumentsForWorkspace(workspace.id, true),
      isDocumentStorageSchemaReady(),
      loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id })
    ]);
    const { data, error } = await supabase
      .from("documents")
      .select("id, name, category, project_id, updated_at, projects(name)")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(100)
      .returns<DocumentRow[]>();

    if (error) {
      throw new Error(`Nie udało się pobrać dokumentów firmy: ${error.message}`);
    }

    const canReadDocument = (document: { category: string | null; project_id: string | null }) => domainAccessPolicyAllows(accessPolicy, {
      domain: domainForDocumentCategory(document.category), level: "read", projectId: document.project_id
    });
    const documents = (data ?? []).filter(canReadDocument);
    const documentSummaries = allDocumentSummaries.filter(canReadDocument);
    const trashedDocuments = allTrashedDocuments.filter(canReadDocument);
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
          projects={projects}
          documents={documentSummaries}
          trashedDocuments={trashedDocuments}
          storageReady={storageReady}
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
                    <small>{document.category || "Dokument"} · {projectName(document)}</small>
                  </div>
                  <time>{document.updated_at ? new Date(document.updated_at).toLocaleDateString("pl-PL") : ""}</time>
                  <Link href={document.project_id ? `/workspace/projects/${document.project_id}/documentation` : `/workspace/companies/${workspace.id}/documents`}>Otwórz →</Link>
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
    const [projects, accessPolicy] = await Promise.all([
      listProjectsForWorkspace(user, workspace.id),
      loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id })
    ]);
    const supabase = createServiceSupabaseClient();
    const { data: reportDocuments } = await supabase
      .from("documents")
      .select("id,category,project_id")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null);
    const documentCount = (reportDocuments ?? []).filter((document) => domainAccessPolicyAllows(accessPolicy, {
      domain: domainForDocumentCategory(document.category), level: "read", projectId: document.project_id
    })).length;
    const statuses = projects.reduce<Record<string, number>>((result, project) => {
      result[project.status] = (result[project.status] ?? 0) + 1;
      return result;
    }, {});

    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">Raporty</p>
            <h1>Raporty i analityka</h1>
            <p>Przekrojowy obraz firmy z danych zgromadzonych w Project Octopus.</p>
          </div>
        </header>
        <section className="co-metric-grid">
          <article className="co-metric-card"><span>Inwestycje</span><strong>{projects.length}</strong><small>łącznie</small></article>
          <article className="co-metric-card"><span>Aktywne</span><strong>{statuses.active ?? 0}</strong><small>w realizacji</small></article>
          <article className="co-metric-card"><span>Zakończone</span><strong>{statuses.completed ?? 0}</strong><small>zamknięte</small></article>
          <article className="co-metric-card"><span>Dokumenty</span><strong>{documentCount}</strong><small>dostępne dla tej roli</small></article>
        </section>
        <section className="co-section">
          <div className="co-section-heading"><div><p className="co-kicker">Analityka</p><h2>Przekroje przygotowane do rozwoju</h2></div></div>
          <div className="co-feature-grid co-feature-grid--reports">
            {[
              ["Raport zarządczy", "Firma, inwestycje i kluczowe odchylenia w jednym podsumowaniu."],
              ["Raport inwestycji", "Postęp, dokumentacja, budżet i ryzyka konkretnej realizacji."],
              ["Raport finansowy", "Przychody, koszty, rentowność i cash flow po uruchomieniu danych finansowych."],
              ["Raport kadrowy", "Obsada, uprawnienia i obciążenie zespołu po uruchomieniu modułu Kadry."],
              ["Raport magazynowy", "Stany, ruchy i zapotrzebowanie materiałowe po uruchomieniu modułu Magazyn."],
              ["Analiza OctopusAI", "Interpretacja danych firmy i wskazanie tematów wymagających uwagi."]
            ].map(([title, description]) => (
              <article className="co-feature-card" key={title}>
                <CheckCircle2 size={19} aria-hidden="true" />
                <h2>{title}</h2>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
        <DomainLivePanel kind="reports" workspaceId={workspace.id} />
      </main>
    );
  }

  if (section === "templates") {
    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div><p className="co-kicker">Wzory</p><h1>Wzory i generatory dokumentów</h1><p>Kontrolowana baza firmowych wzorów do wniosków, protokołów, harmonogramów, raportów i dokumentacji odbiorowej.</p></div>
        </header>
        <TemplateStudio workspaceId={workspace.id} />
      </main>
    );
  }

  if (section === "ai-inbox") {
    const [allItems, accessPolicy] = await Promise.all([
      listAiInbox(workspace.id),
      loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id })
    ]);
    const items = allItems.filter((item) => {
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

  if (section === "brain") {
    const ai = getAiRuntimeStatus();
    return (
      <main className="co-page">
        <header className="co-page-heading"><div><p className="co-kicker">Octopus Brain</p><h1>Centrum analizy firmy</h1><p>AI rozumie kontekst dokumentów, łączy źródła z inwestycjami i proponuje działania, które człowiek może zweryfikować.</p></div><strong className="co-count-badge">{ai.ready ? "Gemini gotowy" : "AI wymaga konfiguracji"}</strong></header>
        <section className="co-feature-grid">
          {[
            ["Automatyczna wrzutnia", "Klasyfikacja dokumentu, wybór inwestycji i modułu oraz kontrola pewności."],
            ["Project DNA", "Zatwierdzone fakty kontraktowe, techniczne, materiałowe i kosztowe z pełnym źródłem."],
            ["Radar skutków zmian", "Wpływ nowej rewizji na kosztorys, harmonogram, wnioski, materiały i protokoły."],
            ["Generowanie kontrolowane", "Wnioski, protokoły i raporty powstają z zatwierdzonych wzorów i danych."],
            ["Pamięć organizacji", "Lekcje z zakończonych inwestycji stają się użyteczną wiedzą firmy."],
            ["Human in the loop", "AI proponuje, reguły walidują, a odpowiedzialna osoba zatwierdza decyzję."]
          ].map(([title, description]) => <article className="co-feature-card" key={title}><Brain size={19} /><h2>{title}</h2><p>{description}</p></article>)}
        </section>
        <section className="co-section"><KnowledgeSearch workspaceId={workspace.id} /></section>
      </main>
    );
  }

  if (section === "knowledge") {
    const [projects, entriesResult] = await Promise.all([
      listProjectsForWorkspace(user, workspace.id),
      createServiceSupabaseClient().from("knowledge_entries").select("id,entry_type,title,summary,solution,tags,status,created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100)
    ]);
    const entries = entriesResult.data ?? [];
    return (
      <main className="co-page">
        <header className="co-page-heading"><div><p className="co-kicker">Pamięć organizacji</p><h1>Sprawdzone rozwiązania i lekcje z inwestycji</h1><p>Wiedza firmy jest wersjonowana, zatwierdzana i zawsze zachowuje informację o pochodzeniu.</p></div><strong className="co-count-badge">{entries.filter((item) => item.status === "approved").length} zatwierdzonych</strong></header>
        <section className="control-dashboard-grid">
          <article className="module-panel"><div className="module-panel__heading"><BookOpenCheck size={20} /><div><p className="eyebrow">Nowy wpis</p><h2>Wiedza do kontroli</h2></div></div><KnowledgeEntryForm workspaceId={workspace.id} projects={projects.map((project) => ({ id: project.id, name: project.name }))} /></article>
          <article className="module-panel"><div className="module-panel__heading"><CheckCircle2 size={20} /><div><p className="eyebrow">Biblioteka</p><h2>Wpisy firmy</h2></div></div><div className="knowledge-entry-list">{entries.map((entry) => <article key={entry.id}>{entry.status === "approved" ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />}<div><small>{entry.entry_type} · {entry.status}</small><strong>{entry.title}</strong><p>{entry.summary}</p><span>{Array.isArray(entry.tags) ? entry.tags.join(" · ") : ""}</span></div></article>)}{!entries.length ? <p className="empty-copy">Pamięć firmy jest jeszcze pusta.</p> : null}</div></article>
        </section>
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
