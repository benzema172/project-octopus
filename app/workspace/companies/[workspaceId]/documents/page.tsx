import Link from "next/link";
import { AlertTriangle, ChevronDown, UploadCloud } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { AiInbox } from "@/components/brain/ai-inbox";
import { DocumentCentralArchive } from "@/components/documents/document-central-archive";
import { DocumentUpload } from "@/components/documents/document-upload";
import { requireCurrentUser } from "@/lib/auth";
import {
  domainAccessPolicyAllows,
  domainForDocumentCategory,
  hasDomainAccess,
  loadDomainAccessPolicy,
  type Domain
} from "@/lib/authorization";
import { listDocumentLibraryInsights } from "@/lib/data/document-library";
import { isDocumentStorageSchemaReady, listDocumentsForWorkspace } from "@/lib/data/documents";
import { listAiInbox } from "@/lib/data/operations";
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

  const [projects, allDocuments, allTrashedDocuments, storageReady, accessPolicy, allAiInboxItems] = await Promise.all([
    listProjectsForWorkspace(user, workspace.id).catch((error) => {
      console.error("Project Octopus: project list fallback in documents", error);
      return [];
    }),
    safeWorkspaceDocuments(workspace.id),
    safeWorkspaceDocuments(workspace.id, true),
    isDocumentStorageSchemaReady().catch(() => false),
    loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id }),
    listAiInbox(workspace.id).catch((error) => {
      console.error("Project Octopus: AI review queue fallback in documents", error);
      return [];
    })
  ]);

  const canReadDocument = (document: { category: string | null; project_id: string | null }) =>
    domainAccessPolicyAllows(accessPolicy, {
      domain: domainForDocumentCategory(document.category),
      level: "read",
      projectId: document.project_id
    });

  const documents = allDocuments.filter(canReadDocument);
  const trashedDocuments = allTrashedDocuments.filter(canReadDocument);
  const insights = await listDocumentLibraryInsights(workspace.id, documents.map((document) => document.id)).catch((error) => {
    console.error("Project Octopus: central document archive insight fallback", error);
    return [];
  });

  const documentQueueItems = allAiInboxItems.flatMap((item) => {
    if (item.entityType !== "document") return [];
    const domain = domainForDocumentCategory(item.category);
    if (!domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId: item.projectId })) return [];
    return [{
      ...item,
      canWrite: domainAccessPolicyAllows(accessPolicy, { domain, level: "write", projectId: item.projectId }),
      canApprove: domainAccessPolicyAllows(accessPolicy, { domain, level: "approve", projectId: item.projectId })
    }];
  });
  const reviewCount = documentQueueItems.filter((item) => item.status === "review").length;
  const errorCount = documentQueueItems.filter((item) => item.status === "error").length;
  const uploadFocused = query.upload === "1";

  return (
    <main className="co-page co-documents-simplified" data-documents-one-flow="1">
      <header className="co-page-heading co-page-heading--compact">
        <div>
          <p className="co-kicker">Dokumenty</p>
          <h1>Centralne archiwum firmy</h1>
          <p>Jedno źródło dokumentu: Wrzutnia zapisuje oryginał, Octopus AI klasyfikuje i odczytuje treść, a moduły korzystają z tego samego rekordu.</p>
        </div>
        <div className="co-heading-actions">
          <strong className="co-count-badge">{documents.length} plików · {reviewCount} do weryfikacji</strong>
          <Link href="#document-review" className="co-text-link">Kolejka decyzji ↓</Link>
        </div>
      </header>

      {!storageReady ? (
        <section className="co-schema-warning" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><strong>Wrzutnia jest chwilowo zablokowana.</strong><span>Centralne archiwum pozostaje dostępne w trybie bezpiecznym.</span></div>
        </section>
      ) : null}

      <details id="wrzutnia" className="co-upload-disclosure" open={uploadFocused}>
        <summary>
          <span><UploadCloud size={17} aria-hidden="true" /><strong>Wrzutnia</strong><small>PDF, Word, Excel, obraz, XML lub ZIP → prywatne R2 → AI / OCR → właściwy moduł</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="co-upload-disclosure__body">
          <DocumentUpload workspaceId={workspace.id} projects={projects} documents={documents} trashedDocuments={trashedDocuments} storageReady={storageReady} />
        </div>
      </details>

      <section className="co-section co-section--compact" aria-labelledby="documents-archive-title">
        <div className="co-section-heading">
          <div><p className="co-kicker">Biblioteka</p><h2 id="documents-archive-title">Archiwum, AI/OCR i routing</h2></div>
          <span>Wyszukiwanie obejmuje nazwę, treść OCR, fakty AI, inwestycję i moduł docelowy</span>
        </div>
        <DocumentCentralArchive
          workspaceId={workspace.id}
          documents={documents}
          projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          insights={insights}
        />
      </section>

      <section id="document-review" className="co-section" aria-labelledby="documents-review-title">
        <div className="co-section-heading">
          <div><p className="co-kicker">Kontrola człowieka</p><h2 id="documents-review-title">Do weryfikacji</h2></div>
          <div className="co-heading-actions"><span>{reviewCount} decyzji · {errorCount} błędów</span><Link href={`/workspace/companies/${workspace.id}/ai-inbox`} className="co-text-link">Pełna Skrzynka AI →</Link></div>
        </div>
        <p className="section-lead">Tutaj poprawiasz kategorię lub inwestycję i zatwierdzasz decyzję AI. Zatwierdzenie nie tworzy drugiego dokumentu — aktualizuje ten sam obieg i pozwala zasilić właściwy moduł.</p>
        <AiInbox
          items={documentQueueItems}
          workspaceId={workspace.id}
          currentUserId={user.id}
          projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        />
      </section>
    </main>
  );
}
