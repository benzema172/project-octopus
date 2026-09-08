import Link from "next/link";
import { AlertTriangle, ChevronDown, FileText, FolderOpen, UploadCloud } from "lucide-react";
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
import styles from "./documents-library.module.css";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ upload?: string; sourceModule?: string }>;
};

type LibraryModuleId = "hr" | "warehouse" | "fleet" | "finance" | "investments" | "templates" | "company" | "unassigned";
type LibraryModule = { id: LibraryModuleId; label: string; caption: string };

const libraryModules: LibraryModule[] = [
  { id: "hr", label: "Kadry", caption: "Umowy, badania, BHP, urlopy i dokumenty pracowników" },
  { id: "warehouse", label: "Magazyn", caption: "Faktury zakupowe, PZ/WZ, materiały, sprzęt i dokumenty magazynowe" },
  { id: "finance", label: "Finanse", caption: "Faktury, koszty, płatności i dokumenty księgowe" },
  { id: "fleet", label: "Flota", caption: "Pojazdy, serwis, ubezpieczenia i dokumentacja floty" },
  { id: "investments", label: "Inwestycje", caption: "Dokumentacja projektowa, kosztorysy, protokoły i pliki inwestycji" },
  { id: "templates", label: "Wzory i Brain", caption: "Szablony, wzory oraz dokumenty referencyjne dla AI" },
  { id: "company", label: "Ogólne firmy", caption: "Dokumenty firmowe niezwiązane z jednym modułem" },
  { id: "unassigned", label: "Nieprzypisane", caption: "Dokumenty, których moduł wymaga jeszcze ustalenia lub weryfikacji" }
];

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

function normalizeLibraryClue(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsAny(haystack: string, terms: string[]) {
  return terms.some((term) => haystack.includes(term));
}

function libraryModuleForDocument(document: DocumentSummary): LibraryModuleId {
  if (document.project_id) return "investments";
  const clue = normalizeLibraryClue(`${document.category ?? ""} ${document.name ?? ""}`);
  if (containsAny(clue, ["warehouse", "magazyn", "stock", "material", "sprzet magazyn"])) return "warehouse";
  if (containsAny(clue, ["hr", "kadry", "employee", "pracownik", "employment", "badanie", "medical", "bhp", "urlop", "leave"])) return "hr";
  if (containsAny(clue, ["fleet", "flota", "vehicle", "pojazd", "samochod", "ubezpieczenie pojazdu"])) return "fleet";
  if (containsAny(clue, ["finance", "finanse", "invoice", "faktura", "ksieg", "platnosc", "payment", "koszt", "cost"])) return "finance";
  if (containsAny(clue, ["project", "inwest", "boq", "wbs", "protokol", "harmonogram", "rysunek", "dokumentacja projektowa"])) return "investments";
  if (containsAny(clue, ["template", "szablon", "wzor", "brain", "referencyj"])) return "templates";
  if (containsAny(clue, ["company", "firmow", "ogoln", "corporate"])) return "company";
  return "unassigned";
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
  const groupedDocuments = libraryModules
    .map((module) => ({ ...module, documents: documents.filter((document) => libraryModuleForDocument(document) === module.id) }))
    .filter((module) => module.documents.length > 0);

  return (
    <main className="co-page co-documents-simplified">
      <header className="co-page-heading co-page-heading--compact">
        <div><p className="co-kicker">Dokumenty</p><h1>Biblioteka firmy</h1><p>Dokumenty są uporządkowane według modułów, do których należą lub zostały przypisane przez AI.</p></div>
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
        <div className="co-section-heading"><div><p className="co-kicker">Biblioteka</p><h2>Dokumenty według modułów</h2></div><span>Najpierw moduł, potem konkretny dokument</span></div>
        {documents.length ? <>
          <div className={styles.moduleSummary} aria-label="Podsumowanie dokumentów według modułów">
            {groupedDocuments.map((group) => <span className={styles.moduleChip} key={group.id}>{group.label}<b>{group.documents.length}</b></span>)}
          </div>
          <div className={styles.moduleGroups}>
            {groupedDocuments.map((group) => (
              <section className={`${styles.moduleCard} ${group.id === "unassigned" ? styles.unassigned : ""}`} key={group.id} aria-labelledby={`documents-module-${group.id}`}>
                <header className={styles.moduleHeader}>
                  <div className={styles.moduleTitle}><span className={styles.moduleIcon}><FolderOpen size={17} aria-hidden="true" /></span><div><strong id={`documents-module-${group.id}`}>{group.label}</strong><small>{group.caption}</small></div></div>
                  <span className={styles.moduleCount}>{group.documents.length}</span>
                </header>
                <div className="co-document-table">
                  {group.documents.map((document) => {
                    const fallbackHref = document.project_id
                      ? `/workspace/projects/${document.project_id}/documentation#document-${document.id}`
                      : `#document-${document.id}`;
                    const versionId = document.current_version_id ?? document.document_versions?.[0]?.id ?? null;
                    return (
                      <article key={document.id} id={`document-${document.id}`}>
                        <span className="co-document-icon"><FileText size={18} aria-hidden="true" /></span>
                        <div><strong>{document.name}</strong><small>{document.category || "Dokument"} · {document.project_id ? projectNames.get(document.project_id) ?? "Inwestycja" : group.label}</small></div>
                        <time>{document.updated_at ? new Date(document.updated_at).toLocaleDateString("pl-PL") : ""}</time>
                        <DocumentOpenLink workspaceId={workspace.id} projectId={document.project_id} versionId={versionId} fallbackHref={fallbackHref} />
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </> : <div className="co-empty-state"><strong>Brak dokumentów w firmie.</strong><p>Otwórz Wrzutnię i dodaj pierwszy plik.</p></div>}
      </section>
    </main>
  );
}
