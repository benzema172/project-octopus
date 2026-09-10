import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
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
import { listAiInbox, type AiInboxItem } from "@/lib/data/operations";
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

function documentNeedsReview(document: DocumentSummary) {
  return document.flow?.stage === "review" || document.ai_status === "review";
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

  const visibleQueueItems = allAiInboxItems.flatMap((item) => {
    if (item.entityType !== "document") return [];
    const domain = domainForDocumentCategory(item.category);
    if (!domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId: item.projectId })) return [];
    return [{
      ...item,
      canWrite: domainAccessPolicyAllows(accessPolicy, { domain, level: "write", projectId: item.projectId }),
      canApprove: domainAccessPolicyAllows(accessPolicy, { domain, level: "approve", projectId: item.projectId })
    } satisfies AiInboxItem];
  });

  // Document Flow is the source of truth for the archive badge. Keep the actionable
  // queue in sync even when a legacy/missing document_intakes row would otherwise
  // make a "Do weryfikacji" document impossible to decide from the Documents view.
  const queueByDocumentId = new Map(visibleQueueItems.map((item) => [item.id, item]));
  for (const document of documents) {
    if (!documentNeedsReview(document)) continue;
    const previous = queueByDocumentId.get(document.id);
    const category = document.flow?.category ?? previous?.category ?? document.category ?? "other";
    const projectId = document.project_id ?? previous?.projectId ?? null;
    const domain = domainForDocumentCategory(category);
    if (!domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId })) continue;
    queueByDocumentId.set(document.id, {
      id: document.id,
      entityType: "document",
      projectId,
      title: document.name,
      subtitle: previous?.subtitle ?? "Decyzja dokumentu · AI / OCR",
      status: "review",
      confidence: document.flow?.confidence ?? previous?.confidence ?? document.ai_confidence ?? null,
      category,
      createdAt: previous?.createdAt ?? document.updated_at ?? document.created_at,
      detail: document.flow?.rationale ?? previous?.detail ?? document.flow?.outcome ?? "Sprawdź kategorię i przypisanie dokumentu przed zatwierdzeniem.",
      proposedProjectId: previous?.proposedProjectId ?? projectId,
      proposedProjectName: previous?.proposedProjectName ?? (projectId ? projects.find((project) => project.id === projectId)?.name ?? null : null),
      requestedCategory: previous?.requestedCategory,
      categoryLocked: previous?.categoryLocked,
      matchStatus: previous?.matchStatus,
      matchReason: previous?.matchReason,
      channel: previous?.channel ?? "document-flow",
      priority: previous?.priority ?? "normal",
      assignedTo: previous?.assignedTo ?? null,
      reviewDueAt: previous?.reviewDueAt ?? null,
      escalationLevel: previous?.escalationLevel ?? 0,
      overdue: previous?.overdue ?? false,
      canWrite: domainAccessPolicyAllows(accessPolicy, { domain, level: "write", projectId }),
      canApprove: domainAccessPolicyAllows(accessPolicy, { domain, level: "approve", projectId })
    });
  }

  const documentQueueItems = [...queueByDocumentId.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const reviewCount = documentQueueItems.filter((item) => item.status === "review").length;
  const projectOptions = projects.map((project) => ({ id: project.id, name: project.name }));

  return (
    <main className="co-page co-documents-simplified" data-documents-one-flow="1">
      <header className="co-page-heading co-page-heading--compact">
        <div>
          <p className="co-kicker">Dokumenty</p>
          <h1>Centralne archiwum firmy</h1>
          <p>Wszystkie nowe pliki zaczynają we Wrzutni. Octopus AI rozpoznaje je, odczytuje i przekazuje do właściwego modułu, a archiwum zachowuje jedno źródło dokumentu.</p>
        </div>
        <div className="co-heading-actions">
          <strong className="co-count-badge">{documents.length} plików · {reviewCount} do weryfikacji</strong>
          <Link href={`/workspace/companies/${workspace.id}/ai-inbox`} className="co-text-link">Pełna Skrzynka AI →</Link>
        </div>
      </header>

      {!storageReady ? (
        <section className="co-schema-warning" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><strong>Wrzutnia jest chwilowo zablokowana.</strong><span>Centralne archiwum pozostaje dostępne w trybie bezpiecznym.</span></div>
        </section>
      ) : null}

      <section className="co-section co-section--compact" aria-labelledby="documents-archive-title">
        <div className="co-section-heading">
          <div><p className="co-kicker">Biblioteka</p><h2 id="documents-archive-title">Wrzutnia i archiwum AI/OCR</h2></div>
          <span>„Wszystkie” to czysta Wrzutnia; pozostałe zakładki pokazują dokumenty już skierowane do odpowiednich obszarów.</span>
        </div>
        <DocumentCentralArchive
          workspaceId={workspace.id}
          documents={documents}
          projects={projectOptions}
          insights={insights}
          reviewItems={documentQueueItems}
          currentUserId={user.id}
          uploadContent={(
            <DocumentUpload
              workspaceId={workspace.id}
              projects={projects}
              documents={documents}
              trashedDocuments={trashedDocuments}
              storageReady={storageReady}
              displayMode="intake"
            />
          )}
        />
      </section>
    </main>
  );
}
