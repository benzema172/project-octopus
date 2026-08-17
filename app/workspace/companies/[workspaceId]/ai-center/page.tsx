import { AlertTriangle, BookOpenCheck, CheckCircle2, CircleDashed, FileSearch, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { KnowledgeEntryForm } from "@/components/brain/knowledge-entry-form";
import { KnowledgeSearch } from "@/components/brain/knowledge-search";
import { DocumentUpload } from "@/components/documents/document-upload";
import { TemplateStudio } from "@/components/templates/template-studio";
import { requireCurrentUser } from "@/lib/auth";
import {
  domainAccessPolicyAllows,
  domainAccessPolicyHasAnyScope,
  domainForDocumentCategory,
  loadDomainAccessPolicy,
  type Domain
} from "@/lib/authorization";
import { isDocumentStorageSchemaReady, listDocumentsForWorkspace } from "@/lib/data/documents";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getAiRuntimeStatus } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DocumentSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ workspaceId: string }> };
type KnowledgeEntry = {
  id: string;
  entry_type: string;
  title: string;
  summary: string;
  solution: string | null;
  tags: string[] | null;
  status: string;
  created_at: string;
};

async function safeWorkspaceDocuments(workspaceId: string, trashed = false) {
  try {
    return await listDocumentsForWorkspace(workspaceId, trashed);
  } catch (error) {
    console.error("Project Octopus: AI center document fallback", {
      workspaceId,
      trashed,
      message: error instanceof Error ? error.message : String(error)
    });
    return [] as DocumentSummary[];
  }
}

export default async function CompanyAiCenterPage({ params }: Props) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();

  const accessPolicy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const canReadAiCenter = (["investments", "templates", "reports"] as Domain[]).some((domain) =>
    domainAccessPolicyHasAnyScope(accessPolicy, { domain, level: "read" })
  );
  if (!canReadAiCenter) return <DomainAccessDenied workspaceId={workspace.id} area="Centrum AI" />;

  const db = createServiceSupabaseClient();
  const [projects, allDocuments, allTrashedDocuments, storageReady, entriesResult] = await Promise.all([
    listProjectsForWorkspace(user, workspace.id).catch((error) => {
      console.error("Project Octopus: AI center project fallback", error);
      return [];
    }),
    safeWorkspaceDocuments(workspace.id),
    safeWorkspaceDocuments(workspace.id, true),
    isDocumentStorageSchemaReady().catch(() => false),
    db.from("knowledge_entries")
      .select("id,entry_type,title,summary,solution,tags,status,created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(100)
  ]);

  const canReadDocument = (document: { category: string | null; project_id: string | null }) =>
    domainAccessPolicyAllows(accessPolicy, {
      domain: domainForDocumentCategory(document.category),
      level: "read",
      projectId: document.project_id
    });
  const documents = allDocuments.filter(canReadDocument);
  const trashedDocuments = allTrashedDocuments.filter(canReadDocument);
  const entries = (entriesResult.data ?? []) as KnowledgeEntry[];
  const approvedEntries = entries.filter((item) => item.status === "approved").length;
  const ai = getAiRuntimeStatus();

  return (
    <main className="co-page">
      <header className="co-page-heading">
        <div>
          <p className="co-kicker">Centrum AI</p>
          <h1>Wzory, wiedza firmy i Octopus Brain</h1>
          <p>To jest zaplecze wiedzy AI: tutaj uczysz system na sprawdzonych źródłach, przechowujesz wzory i przeszukujesz zatwierdzone informacje.</p>
        </div>
        <strong className="co-count-badge">{ai.ready ? `AI aktywne · ${ai.model}` : "AI wymaga konfiguracji"}</strong>
      </header>

      {!storageReady || entriesResult.error ? (
        <section className="co-schema-warning" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>Centrum AI działa w trybie odpornym na brakujące dane.</strong>
            <span>{!storageReady ? "Wrzutnia źródeł pozostaje zablokowana do czasu pełnej migracji magazynu dokumentów. " : ""}{entriesResult.error ? "Baza wiedzy nie odpowiedziała, ale reszta strony pozostaje dostępna." : ""}</span>
          </div>
        </section>
      ) : null}

      <section className="ai-center-flow" aria-label="Obieg wiedzy AI">
        <article><Sparkles size={18} /><strong>1. Dodaj źródło</strong><span>Wzór, instrukcję, dokument referencyjny albo sprawdzoną wiedzę firmy.</span></article>
        <article><FileSearch size={18} /><strong>2. AI analizuje</strong><span>Wyciąga treść, typ dokumentu, kontekst, fakty i możliwe zastosowania.</span></article>
        <article><CheckCircle2 size={18} /><strong>3. Człowiek zatwierdza</strong><span>Niepewne elementy trafiają do Skrzynki AI i nie są automatycznie uznawane za prawdę.</span></article>
        <article><BookOpenCheck size={18} /><strong>4. Octopus wykorzystuje</strong><span>Zatwierdzona wiedza zasila wyszukiwanie, analizy i generowanie dokumentów.</span></article>
      </section>

      <section className="co-metric-grid" aria-label="Stan Centrum AI">
        <article className="co-metric-card"><span>Źródła</span><strong>{documents.length}</strong><small>dokumentów dostępnych dla tego użytkownika</small></article>
        <article className="co-metric-card"><span>Wiedza zatwierdzona</span><strong>{approvedEntries}</strong><small>wpisów pamięci firmy</small></article>
        <article className="co-metric-card"><span>Inwestycje</span><strong>{projects.length}</strong><small>kontekstów do dopasowania</small></article>
        <article className="co-metric-card co-metric-card--ai"><span>Silnik AI</span><strong>{ai.ready ? "Gotowy" : "Offline"}</strong><small>{ai.provider} · {ai.model}</small></article>
      </section>

      <section className="co-section">
        <div className="co-section-heading">
          <div><p className="co-kicker">Materiały dla AI</p><h2>Wrzutnia i biblioteka źródeł</h2></div>
          <strong>{documents.length} dokumentów</strong>
        </div>
        <DocumentUpload
          workspaceId={workspace.id}
          projects={projects}
          documents={documents}
          trashedDocuments={trashedDocuments}
          storageReady={storageReady}
          defaultCategory="template"
        />
      </section>

      <TemplateStudio workspaceId={workspace.id} />

      <section className="control-dashboard-grid ai-center-knowledge">
        <article className="module-panel">
          <div className="module-panel__heading"><BookOpenCheck size={20} /><div><p className="eyebrow">Pamięć firmy</p><h2>Dodaj sprawdzoną wiedzę</h2></div></div>
          <p>Dodawaj tu zasady, rozwiązania problemów i doświadczenia, które mają być później używane przez AI jako zatwierdzona wiedza organizacji.</p>
          <KnowledgeEntryForm workspaceId={workspace.id} projects={projects.map((project) => ({ id: project.id, name: project.name }))} />
        </article>
        <article className="module-panel">
          <div className="module-panel__heading"><CheckCircle2 size={20} /><div><p className="eyebrow">Biblioteka wiedzy</p><h2>{approvedEntries} zatwierdzonych</h2></div></div>
          <div className="knowledge-entry-list">
            {entries.map((entry) => (
              <article key={entry.id}>
                {entry.status === "approved" ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />}
                <div><small>{entry.entry_type} · {entry.status}</small><strong>{entry.title}</strong><p>{entry.summary}</p><span>{Array.isArray(entry.tags) ? entry.tags.join(" · ") : ""}</span></div>
              </article>
            ))}
            {!entries.length ? <p className="empty-copy">Nie ma jeszcze wpisów wiedzy. Dodaj pierwszy sprawdzony przypadek lub zasadę firmy.</p> : null}
          </div>
        </article>
      </section>

      <section className="co-section">
        <div className="co-section-heading"><div><p className="co-kicker">Octopus Brain</p><h2>Przeszukaj zatwierdzoną wiedzę ze źródłami</h2></div></div>
        <p className="section-lead">Wyszukiwanie ma odpowiadać na pytanie „skąd to wiemy”, a nie tylko zwracać wygenerowany tekst. Wynik powinien wskazywać dokument lub wpis wiedzy, z którego pochodzi informacja.</p>
        <KnowledgeSearch workspaceId={workspace.id} />
      </section>
    </main>
  );
}
