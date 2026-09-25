import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { DocumentCentralArchive, type ArchiveTabId } from "@/components/documents/document-central-archive";
import { DocumentUpload } from "@/components/documents/document-upload";
import { ServerPagination } from "@/components/system/server-pagination";
import { requireCurrentUser } from "@/lib/auth";
import {
  domainAccessPolicyAllows,
  domainForDocumentCategory,
  hasDomainAccess,
  loadDomainAccessPolicy,
  type Domain
} from "@/lib/authorization";
import { listDocumentLibraryInsights } from "@/lib/data/document-library";
import {
  countDocumentsForWorkspace,
  getDocumentArchiveFacets,
  isDocumentStorageSchemaReady,
  listDocumentsForWorkspacePage,
  type DocumentArchiveFacets
} from "@/lib/data/documents";
import { listDocumentAiInbox, type AiInboxItem } from "@/lib/data/operations";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { normalizeDocumentSourceModule, sourceModuleLabel } from "@/lib/documents/source-module";
import type { DocumentSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ upload?: string; sourceModule?: string; page?: string; trashPage?: string; tab?: string; q?: string }>;
};

const ARCHIVE_TABS = new Set<ArchiveTabId>([
  "all", "review", "investments", "finance", "warehouse", "hr", "fleet", "templates", "company", "unassigned", "trash"
]);

function normalizeArchiveTab(value: string | undefined): ArchiveTabId {
  return value && ARCHIVE_TABS.has(value as ArchiveTabId) ? value as ArchiveTabId : "all";
}

async function safeWorkspaceDocumentsPage(
  workspaceId: string,
  options: { trashed?: boolean; page?: number; pageSize?: number; query?: string; module?: string; review?: boolean }
) {
  try {
    return await listDocumentsForWorkspacePage(workspaceId, options);
  } catch (error) {
    console.error("Project Octopus: company documents fallback", {
      workspaceId,
      trashed: options.trashed ?? false,
      query: options.query ?? "",
      module: options.module ?? "",
      review: options.review ?? false,
      message: error instanceof Error ? error.message : String(error)
    });
    return { items: [] as DocumentSummary[], total: 0, page: Math.max(1, options.page ?? 1), pageSize: options.pageSize ?? 60 };
  }
}

function sourceModuleDomain(sourceModule: ReturnType<typeof normalizeDocumentSourceModule>): Domain {
  if (sourceModule === "warehouse") return "warehouse";
  if (sourceModule === "finance") return "finance";
  if (sourceModule === "hr") return "hr";
  if (sourceModule === "fleet") return "fleet";
  return "investments";
}

function documentNeedsReview(document: DocumentSummary) {
  return document.flow?.stage === "review" || document.ai_status === "review";
}

const MODULE_FILTER_TABS = new Set<ArchiveTabId>(["investments", "finance", "warehouse", "hr", "fleet", "templates", "company", "unassigned"]);

export default async function CompanyDocumentsPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const sourceModule = normalizeDocumentSourceModule(query.sourceModule);
  const activeTab = normalizeArchiveTab(query.tab);
  const searchQuery = activeTab === "all" || activeTab === "trash" ? "" : String(query.q ?? "").trim();
  const archivePage = Math.max(1, Math.floor(Number(query.page ?? 1) || 1));
  const trashPage = Math.max(1, Math.floor(Number(query.trashPage ?? 1) || 1));
  const moduleFilter = MODULE_FILTER_TABS.has(activeTab) ? activeTab : undefined;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) notFound();
  const pageDomain = sourceModuleDomain(sourceModule);
  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: pageDomain, level: "read" })) {
    return <DomainAccessDenied workspaceId={workspace.id} area={sourceModule ? `Wrzutnia — ${sourceModuleLabel(sourceModule)}` : "Dokumenty"} />;
  }

  const emptyPage = { items: [] as DocumentSummary[], total: 0, page: 1, pageSize: 60 };
  const emptyTrashPage = { items: [] as DocumentSummary[], total: 0, page: trashPage, pageSize: 40 };
  const zeroFacets: DocumentArchiveFacets = {
    all: 0, review: 0, investments: 0, finance: 0, warehouse: 0,
    hr: 0, fleet: 0, templates: 0, company: 0, unassigned: 0
  };

  const [projects, documentsPage, trashedPage, trashTotal, storageReady, accessPolicy, facets] = await Promise.all([
    listProjectsForWorkspace(user, workspace.id).catch((error) => {
      console.error("Project Octopus: project list fallback in documents", error);
      return [];
    }),
    activeTab === "trash"
      ? Promise.resolve(emptyPage)
      : safeWorkspaceDocumentsPage(workspace.id, {
          page: archivePage,
          pageSize: 60,
          query: searchQuery,
          module: moduleFilter,
          review: activeTab === "review"
        }),
    activeTab === "trash"
      ? safeWorkspaceDocumentsPage(workspace.id, { trashed: true, page: trashPage, pageSize: 40 })
      : Promise.resolve(emptyTrashPage),
    countDocumentsForWorkspace(workspace.id, true).catch(() => 0),
    isDocumentStorageSchemaReady().catch(() => false),
    loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id }),
    getDocumentArchiveFacets(workspace.id, searchQuery).catch((error) => {
      console.error("Project Octopus: document archive facets fallback", error);
      return zeroFacets;
    })
  ]);

  const canReadDocument = (document: { category: string | null; project_id: string | null }) =>
    domainAccessPolicyAllows(accessPolicy, {
      domain: domainForDocumentCategory(document.category),
      level: "read",
      projectId: document.project_id
    });

  const documents = documentsPage.items.filter(canReadDocument);
  const trashedDocuments = trashedPage.items.filter(canReadDocument);
  const insights = activeTab === "all" || activeTab === "trash"
    ? []
    : await listDocumentLibraryInsights(workspace.id, documents.map((document) => document.id)).catch((error) => {
        console.error("Project Octopus: central document archive insight fallback", error);
        return [];
      });

  const rawQueueItems = activeTab === "all" || activeTab === "trash"
    ? []
    : await listDocumentAiInbox(workspace.id, documents.map((document) => document.id)).catch((error) => {
        console.error("Project Octopus: document-only AI review queue fallback", error);
        return [];
      });

  const visibleQueueItems = rawQueueItems.flatMap((item) => {
    const domain = domainForDocumentCategory(item.category);
    if (!domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId: item.projectId })) return [];
    return [{
      ...item,
      canWrite: domainAccessPolicyAllows(accessPolicy, { domain, level: "write", projectId: item.projectId }),
      canApprove: domainAccessPolicyAllows(accessPolicy, { domain, level: "approve", projectId: item.projectId })
    } satisfies AiInboxItem];
  });

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
  const projectOptions = projects.map((project) => ({ id: project.id, name: project.name }));
  const facetCounts: Record<ArchiveTabId, number> = { ...facets, trash: trashTotal };

  return (
    <main className="co-page co-documents-simplified" data-documents-one-flow="1">
      <header className="co-page-heading co-page-heading--compact">
        <div>
          <p className="co-kicker">Dokumenty</p>
          <h1>Centralne archiwum firmy</h1>
          <p>Wszystkie nowe pliki zaczynają we Wrzutni. Octopus AI rozpoznaje je, odczytuje i przekazuje do właściwego modułu, a archiwum zachowuje jedno źródło dokumentu.</p>
        </div>
        <div className="co-heading-actions">
          <strong className="co-count-badge">{facets.all} plików · {facets.review} do weryfikacji</strong>
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
          <span>Wyszukiwanie obejmuje całe archiwum firmy: nazwy, OCR, fakty AI, inwestycje i propozycje modułowe.</span>
        </div>
        <DocumentCentralArchive
          workspaceId={workspace.id}
          documents={documents}
          trashedDocuments={trashedDocuments}
          projects={projectOptions}
          insights={insights}
          reviewItems={documentQueueItems}
          currentUserId={user.id}
          activeTab={activeTab}
          searchQuery={searchQuery}
          facetCounts={facetCounts}
          total={activeTab === "trash" ? trashTotal : documentsPage.total}
          uploadContent={(
            <DocumentUpload
              workspaceId={workspace.id}
              projects={projects}
              documents={documents}
              trashedDocuments={[]}
              storageReady={storageReady}
              displayMode="intake"
            />
          )}
        />
        {activeTab !== "all" && activeTab !== "trash" ? (
          <ServerPagination
            page={documentsPage.page}
            pageSize={documentsPage.pageSize}
            total={documentsPage.total}
            pathname={`/workspace/companies/${workspace.id}/documents`}
            query={{ sourceModule: query.sourceModule, tab: activeTab, q: searchQuery || undefined }}
          />
        ) : null}
        {activeTab === "trash" ? (
          <ServerPagination
            page={trashPage}
            pageSize={trashedPage.pageSize}
            total={trashTotal}
            pathname={`/workspace/companies/${workspace.id}/documents`}
            query={{ sourceModule: query.sourceModule, tab: "trash" }}
            pageParam="trashPage"
          />
        ) : null}
      </section>
    </main>
  );
}
