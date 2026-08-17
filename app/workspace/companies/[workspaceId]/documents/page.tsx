import Link from "next/link";
import { AlertTriangle, FileText, UploadCloud } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { DocumentUpload } from "@/components/documents/document-upload";
import { requireCurrentUser } from "@/lib/auth";
import {
  domainAccessPolicyAllows,
  domainForDocumentCategory,
  hasDomainAccess,
  loadDomainAccessPolicy
} from "@/lib/authorization";
import { isDocumentStorageSchemaReady, listDocumentsForWorkspace } from "@/lib/data/documents";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import type { DocumentSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ upload?: string }>;
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

export default async function CompanyDocumentsPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) notFound();

  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "investments", level: "read" })) {
    return <DomainAccessDenied workspaceId={workspace.id} area="Dokumenty" />;
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
    <main className="co-page">
      <header className="co-page-heading">
        <div>
          <p className="co-kicker">Dokumenty</p>
          <h1>Centralne dokumenty firmy</h1>
          <p>Wrzutnia, biblioteka i wersjonowanie plików całej firmy bez blokowania strony, gdy część warstwy AI lub magazynu nie jest jeszcze gotowa.</p>
        </div>
        <strong className="co-count-badge">{documents.length} plików</strong>
      </header>

      {!storageReady ? (
        <section className="co-schema-warning" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>Biblioteka działa w trybie bezpiecznym, ale Wrzutnia jest chwilowo zablokowana.</strong>
            <span>Brakuje kompletnej warstwy składowania dokumentów. Strona pozostaje dostępna zamiast kończyć się błędem serwera.</span>
          </div>
        </section>
      ) : null}

      <section className="co-category-strip" aria-label="Główne kategorie dokumentów">
        {["Umowy", "Faktury", "Dokumentacja techniczna", "Kosztorysy", "Protokoły", "WZ / PZ", "Załączniki", "OCR / AI"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </section>

      <section className="document-principles">
        <div><strong>1. Wrzucasz</strong><span>PDF, Word, Excel, obraz, XML lub ZIP trafia do prywatnego R2.</span></div>
        <div><strong>2. AI rozumie</strong><span>Ekstrakcja treści, klasyfikacja, dane handlowe i propozycja inwestycji.</span></div>
        <div><strong>3. Weryfikujesz</strong><span>Niepewne decyzje pojawiają się w Skrzynce AI zamiast być zapisywane w ciemno.</span></div>
        <div><strong>4. Moduły korzystają</strong><span>Faktury, WZ, kosztorysy i dokumentacja zasilają właściwe obszary systemu.</span></div>
      </section>

      <section id="wrzutnia" className="co-section">
        <div className="co-section-heading">
          <div>
            <p className="co-kicker">Wrzutnia {uploadFocused ? "· szybkie dodawanie" : ""}</p>
            <h2>Dodaj plik i pozwól Octopusowi go sklasyfikować</h2>
          </div>
          <span><UploadCloud size={17} aria-hidden="true" /> R2 → ekstrakcja → AI → moduł</span>
        </div>
        <DocumentUpload
          workspaceId={workspace.id}
          projects={projects}
          documents={documentSummaries}
          trashedDocuments={trashedDocuments}
          storageReady={storageReady}
        />
      </section>

      <section className="co-section">
        <div className="co-section-heading">
          <div><p className="co-kicker">Biblioteka</p><h2>Ostatnio aktualizowane</h2></div>
          <Link href={`/workspace/companies/${workspace.id}/ai-inbox`} className="co-text-link">Decyzje AI →</Link>
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
                <Link href={document.project_id ? `/workspace/projects/${document.project_id}/documentation#document-${document.id}` : `#document-${document.id}`}>Otwórz →</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="co-empty-state">
            <strong>Brak dokumentów w firmie.</strong>
            <p>Możesz korzystać z Wrzutni od razu po aktywacji warstwy składowania.</p>
          </div>
        )}
      </section>
    </main>
  );
}
