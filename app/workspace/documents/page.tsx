import { DocumentUpload } from "@/components/documents/document-upload";
import { requireCurrentUser } from "@/lib/auth";
import { isDocumentStorageSchemaReady, listDocumentsForWorkspace } from "@/lib/data/documents";
import { listProjectsForUser } from "@/lib/data/projects";
import { ensureWorkspaceForUser } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const user = await requireCurrentUser();
  const workspace = await ensureWorkspaceForUser(user);
  const [projects, documents, trashedDocuments, storageReady] = await Promise.all([
    listProjectsForUser(user),
    listDocumentsForWorkspace(workspace.id),
    listDocumentsForWorkspace(workspace.id, true),
    isDocumentStorageSchemaReady()
  ]);

  return (
    <main className="workspace-page documents-page">
      <section className="module-heading">
        <div>
          <p className="eyebrow">Centralna biblioteka</p>
          <h1>Dokumenty i Wrzutnia</h1>
          <p>Jeden plik źródłowy, wiele bezpiecznych powiązań z inwestycjami, finansami, kadrami, magazynem, flotą i wzorami.</p>
        </div>
        <span className="status-pill">{documents.length} aktywnych dokumentów</span>
      </section>

      <section className="document-principles">
        <div><strong>1. Wrzucasz</strong><span>R2 pozostaje trwałym źródłem pliku.</span></div>
        <div><strong>2. AI rozumie</strong><span>Ekstrakcja, OCR, klasyfikacja i fakty.</span></div>
        <div><strong>3. Zatwierdzasz</strong><span>Źródła i pewność są zawsze widoczne.</span></div>
        <div><strong>4. System wykorzystuje</strong><span>Dokument zasila właściwe moduły bez duplikacji.</span></div>
      </section>

      <DocumentUpload
        workspaceId={workspace.id}
        projects={projects}
        documents={documents}
        trashedDocuments={trashedDocuments}
        storageReady={storageReady}
      />
    </main>
  );
}
