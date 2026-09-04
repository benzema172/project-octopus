import Link from "next/link";
import { AlertTriangle, ChevronDown, FileText, UploadCloud } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { DocumentOpenLink } from "@/components/documents/document-open-link";
import { DocumentUpload } from "@/components/documents/document-upload";
import { requireCurrentUser } from "@/lib/auth";
import {
  domainAccessPolicyAllows,
  domainForDocumentCategory,
  hasDomainAccess,
  loadDomainAccessPolicy,
  type Domain
} from "@/lib/authorization";
import { isDocumentStorageSchemaReady, listDocumentsForWorkspace } from "@/lib/data/documents";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { normalizeDocumentSourceModule, sourceModuleLabel } from "@/lib/documents/source-module";
import type { DocumentSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ upload?: string; sourceModule?: string }>;
};

async function safeWorkspaceDocuments(workspaceId: string, trashed = false) {
  try {
    return await listDocumentsForWorkspace(workspaceId, trashed);
  } catch (error) {
    console.error("Project Octopus: company documents fallback", {
      workspaceId,
      trashed,
      message: error instanceof Error ? error.message : String(error)
    });
    return [] as DocumentSummary[];
  }
}

function sourceModuleDomain(sourceModule: ReturnType<typeof normalizeDocumentSourceModule>): Domain {
  if (sourceModule === "warehouse") return "warehouse";
  if (sourceModule === "hr") return "hr";
  if (sourceModule === "fleet") return "fleet";
  return "investments";
}

export default async function CompanyDocumentsPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const sourceModule = normalizeDocumentSourceModule(query.sourceModule);
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) notFound();
  const pageDomain = sourceModuleDomain(sourceModule);
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: pageDomain, level: "read" })) {
    return <DomainAccessDenied workspaceId={workspace.id} area={sourceModule ? `Wrzutnia — ${sourceModuleLabel(sourceModule)}` : "Dokumenty"} />;
  }

  const [projects, allDocuments, allTrashedDocuments, storageReady, accessPolicy] = await Promise.all([
    listProjectsForWorkspace(user, workspace.id).catch((error) => {
      console.error("Project Octopus: project list fallback in documents", error);
      return [];
    }),
    safeWorkspaceDocuments(workspace.id),
    safeWorkspaceDocuments(workspace.id, true),
    isDocumentStorageSchemaReady().catch(() => false),
    loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id })
  ]);

  const canReadDocument = (document: { category: string | null; project_id: string | null }) =>
    domainAccessPolicyAllows(accessPolicy, {
      domain: domainForDocumentCategory(document.category),
      level: "read",
      projectId: document.project_id
    });

  const documentSummaries = allDocuments.filter(canReadDocument);
  const documents = documentSummaries.slice(0, 100);
  const trashedDocuments = allTrashedDocuments.filter(canReadDocument);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const uploadFocused = query.upload === "1";

  return (
    <main className="co-page co-documents-simplified">
      <header className="co-page-heading co-page-heading--compact">
        <div><p className="co-kicker">Dokumenty</p><h1>Biblioteka firmy</h1><p>Wszystkie pliki, ich przypisania i wynik analizy AI w jednym miejscu.</p></div>
        <div className="co-heading-actions"><strong className="co-count-badge">{documents.length} plików</strong><Link href={`/workspace/companies/${workspace.id}/ai-inbox`} className="co-text-link">Do weryfikacji →</Link></div>
      </header>

      {!storageReady ? (
        <section className="co-schema-warning" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><strong>Wrzutnia jest chwilowo zablokowana.</strong><span>Biblioteka pozostaje dostępna w trybie bezpiecznym.</span></div>
        </section>
      ) : null}

      <details id="wrzutnia" className="co-upload-disclosure" open={uploadFocused}>
        <summary><span><UploadCloud size={17} aria-hidden="true" /><strong>Wrzutnia</strong><small>PDF, Word, Excel, obraz, XML lub ZIP → AI → właściwy moduł</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="co-upload-disclosure__body">
          <DocumentUpload workspaceId={workspace.id} projects={projects} documents={documentSummaries} trashedDocuments={trashedDocuments} storageReady={storageReady} />
        </div>
      </details>

      <section className="co-section co-section--compact">
        <div className="co-section-heading"><div><p className="co-kicker">Biblioteka</p><h2>Ostatnio aktualizowane</h2></div><span>AI klasyfikuje i proponuje przypisanie automatycznie</span></div>
        {documents.length ? (
          <div className="co-document-table">
            {documents.map((document) => {
              const fallbackHref = document.project_id
                ? `/workspace/projects/${document.project_id}/documentation#document-${document.id}`
                : `#document-${document.id}`;
              const versionId = document.current_version_id ?? document.document_versions?.[0]?.id ?? null;
              return (
                <article key={document.id} id={`document-${document.id}`}>
                  <span className="co-document-icon"><FileText size={18} aria-hidden="true" /></span>
                  <div><strong>{document.name}</strong><small>{document.category || "Dokument"} · {document.project_id ? projectNames.get(document.project_id) ?? "Inwestycja" : "Dokument firmowy"}</small></div>
                  <time>{document.updated_at ? new Date(document.updated_at).toLocaleDateString("pl-PL") : ""}</time>
                  <DocumentOpenLink workspaceId={workspace.id} projectId={document.project_id} versionId={versionId} fallbackHref={fallbackHref} />
                </article>
              );
            })}
          </div>
        ) : <div className="co-empty-state"><strong>Brak dokumentów w firmie.</strong><p>Otwórz Wrzutnię i dodaj pierwszy plik.</p></div>}
      </section>
    </main>
  );
}
