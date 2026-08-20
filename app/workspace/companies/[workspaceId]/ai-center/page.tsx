import Link from "next/link";
import { AlertTriangle, BookOpenCheck, CheckCircle2, ChevronDown, CircleDashed, Inbox, Search, UploadCloud } from "lucide-react";
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
type KnowledgeEntry = { id: string; entry_type: string; title: string; summary: string; solution: string | null; tags: string[] | null; status: string; created_at: string };

async function safeWorkspaceDocuments(workspaceId: string, trashed = false) {
  try { return await listDocumentsForWorkspace(workspaceId, trashed); }
  catch (error) {
    console.error("Project Octopus: AI center document fallback", { workspaceId, trashed, message: error instanceof Error ? error.message : String(error) });
    return [] as DocumentSummary[];
  }
}

export default async function CompanyAiCenterPage({ params }: Props) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();

  const accessPolicy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const canReadAiCenter = (["investments", "templates", "reports"] as Domain[]).some((domain) => domainAccessPolicyHasAnyScope(accessPolicy, { domain, level: "read" }));
  if (!canReadAiCenter) return <DomainAccessDenied workspaceId={workspace.id} area="OctopusAI" />;

  const db = createServiceSupabaseClient();
  const [projects, allDocuments, allTrashedDocuments, storageReady, entriesResult] = await Promise.all([
    listProjectsForWorkspace(user, workspace.id).catch((error) => { console.error("Project Octopus: AI center project fallback", error); return []; }),
    safeWorkspaceDocuments(workspace.id),
    safeWorkspaceDocuments(workspace.id, true),
    isDocumentStorageSchemaReady().catch(() => false),
    db.from("knowledge_entries").select("id,entry_type,title,summary,solution,tags,status,created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100)
  ]);

  const canReadDocument = (document: { category: string | null; project_id: string | null }) => domainAccessPolicyAllows(accessPolicy, { domain: domainForDocumentCategory(document.category), level: "read", projectId: document.project_id });
  const documents = allDocuments.filter(canReadDocument);
  const trashedDocuments = allTrashedDocuments.filter(canReadDocument);
  const entries = (entriesResult.data ?? []) as KnowledgeEntry[];
  const approvedEntries = entries.filter((item) => item.status === "approved").length;
  const ai = getAiRuntimeStatus();

  return (
    <main className="co-page co-ai-hub">
      <header className="co-page-heading co-page-heading--compact">
        <div><p className="co-kicker">OctopusAI</p><h1>Wiedza i decyzje AI</h1><p>Sprawdzona wiedza firmy, wzory, wyszukiwanie ze źródłami i elementy wymagające decyzji.</p></div>
        <strong className={`co-count-badge${ai.ready ? " is-ready" : ""}`}>{ai.ready ? `AI aktywne · ${ai.model}` : "AI wymaga konfiguracji"}</strong>
      </header>

      <nav className="co-ai-tabs" aria-label="OctopusAI">
        <Link href={`/workspace/companies/${workspace.id}/ai-inbox`}><Inbox size={16} aria-hidden="true" /> Do decyzji</Link>
        <a href="#knowledge"><BookOpenCheck size={16} aria-hidden="true" /> Wiedza <span>{approvedEntries}</span></a>
        <a href="#templates">Wzory</a>
        <a href="#search"><Search size={16} aria-hidden="true" /> Szukaj</a>
      </nav>

      {!storageReady || entriesResult.error ? (
        <section className="co-schema-warning" role="status"><AlertTriangle size={17} aria-hidden="true" /><div><strong>Część zaplecza AI jest chwilowo ograniczona.</strong><span>{!storageReady ? "Dodawanie nowych źródeł jest zablokowane. " : ""}{entriesResult.error ? "Baza wiedzy chwilowo nie odpowiedziała." : ""}</span></div></section>
      ) : null}

      <section id="knowledge" className="control-dashboard-grid ai-center-knowledge co-ai-knowledge-primary">
        <article className="module-panel">
          <div className="module-panel__heading"><BookOpenCheck size={20} /><div><p className="eyebrow">Pamięć firmy</p><h2>Dodaj sprawdzoną wiedzę</h2></div></div>
          <KnowledgeEntryForm workspaceId={workspace.id} projects={projects.map((project) => ({ id: project.id, name: project.name }))} />
        </article>
        <article className="module-panel">
          <div className="module-panel__heading"><CheckCircle2 size={20} /><div><p className="eyebrow">Biblioteka wiedzy</p><h2>{approvedEntries} zatwierdzonych</h2></div></div>
          <div className="knowledge-entry-list">
            {entries.slice(0,12).map((entry) => <article key={entry.id}>{entry.status === "approved" ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />}<div><small>{entry.entry_type} · {entry.status}</small><strong>{entry.title}</strong><p>{entry.summary}</p><span>{Array.isArray(entry.tags) ? entry.tags.join(" · ") : ""}</span></div></article>)}
            {!entries.length ? <p className="empty-copy">Nie ma jeszcze wpisów wiedzy.</p> : null}
          </div>
        </article>
      </section>

      <section id="search" className="co-section co-section--compact">
        <div className="co-section-heading"><div><p className="co-kicker">Szukaj</p><h2>Zapytaj Octopus Brain</h2></div><span>Odpowiedzi ze wskazaniem źródła</span></div>
        <KnowledgeSearch workspaceId={workspace.id} />
      </section>

      <details className="co-ai-disclosure">
        <summary><span><UploadCloud size={17} aria-hidden="true" /><strong>Źródła dla AI</strong><small>{documents.length} dokumentów</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="co-ai-disclosure__body"><DocumentUpload workspaceId={workspace.id} projects={projects} documents={documents} trashedDocuments={trashedDocuments} storageReady={storageReady} defaultCategory="template" /></div>
      </details>

      <details id="templates" className="co-ai-disclosure">
        <summary><span><strong>Wzory i szablony</strong><small>Dokumenty generowane przez Project Octopus</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="co-ai-disclosure__body"><TemplateStudio workspaceId={workspace.id} /></div>
      </details>
    </main>
  );
}
