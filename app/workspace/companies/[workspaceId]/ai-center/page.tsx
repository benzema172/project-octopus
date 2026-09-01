import Link from "next/link";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Inbox,
  Plus,
  Search,
  UploadCloud
} from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { AiInbox } from "@/components/brain/ai-inbox";
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
import { listAiInbox } from "@/lib/data/operations";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getAiRuntimeStatus } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { DocumentSummary } from "@/lib/types";
import styles from "./ai-center.module.css";

export const dynamic = "force-dynamic";

type AiCenterTab = "decisions" | "knowledge" | "templates" | "search";
type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ tab?: string }>;
};
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

const VALID_TABS: AiCenterTab[] = ["decisions", "knowledge", "templates", "search"];

function normalizeTab(value: string | undefined): AiCenterTab | null {
  return VALID_TABS.includes(value as AiCenterTab) ? value as AiCenterTab : null;
}

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

export default async function CompanyAiCenterPage({ params, searchParams }: Props) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();

  const accessPolicy = await loadDomainAccessPolicy({ workspaceId: workspace.id, userId: user.id });
  const canReadAiCenter = (["investments", "templates", "reports"] as Domain[]).some((domain) =>
    domainAccessPolicyHasAnyScope(accessPolicy, { domain, level: "read" })
  );
  if (!canReadAiCenter) return <DomainAccessDenied workspaceId={workspace.id} area="OctopusAI" />;

  const db = createServiceSupabaseClient();
  const [projects, allDocuments, allTrashedDocuments, storageReady, entriesResult, allInboxItems] = await Promise.all([
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
      .limit(100),
    listAiInbox(workspace.id).catch((error) => {
      console.error("Project Octopus: AI center inbox fallback", error);
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
  const entries = (entriesResult.data ?? []) as KnowledgeEntry[];
  const approvedEntries = entries.filter((entry) => entry.status === "approved").length;
  const templateDocuments = documents.filter((document) => document.category === "template").length;

  const inboxItems = allInboxItems.flatMap((item) => {
    const domain: Domain = item.entityType === "template_version"
      ? "templates"
      : item.entityType === "knowledge_entry"
        ? "reports"
        : item.entityType === "document"
          ? domainForDocumentCategory(item.category)
          : "investments";
    if (!domainAccessPolicyAllows(accessPolicy, { domain, level: "read", projectId: item.projectId })) return [];
    return [{
      ...item,
      canWrite: domainAccessPolicyAllows(accessPolicy, { domain, level: "write", projectId: item.projectId }),
      canApprove: domainAccessPolicyAllows(accessPolicy, { domain, level: "approve", projectId: item.projectId })
    }];
  });
  const decisionItems = inboxItems.filter((item) => item.status === "review" || item.status === "error");
  const activeTab = normalizeTab(query.tab) ?? (decisionItems.length ? "decisions" : "search");
  const baseHref = `/workspace/companies/${workspace.id}/ai-center`;
  const ai = getAiRuntimeStatus();

  const tabs: Array<{ key: AiCenterTab; label: string; icon: typeof Inbox; count?: number }> = [
    { key: "decisions", label: "Do decyzji", icon: Inbox, count: decisionItems.length },
    { key: "knowledge", label: "Wiedza", icon: BookOpenCheck, count: approvedEntries },
    { key: "templates", label: "Wzory", icon: UploadCloud, count: templateDocuments },
    { key: "search", label: "Szukaj", icon: Search }
  ];

  return (
    <main className={`${styles.hub} co-page co-ai-hub`}>
      <header className={`${styles.header} co-page-heading co-page-heading--compact`}>
        <div>
          <p className="co-kicker">OctopusAI</p>
          <h1>Wiedza i decyzje AI</h1>
          <p>Wiedza firmy, wzory, decyzje i wyszukiwanie ze wskazaniem źródeł.</p>
        </div>
        <strong className={`co-count-badge${ai.ready ? " is-ready" : ""}`}>
          {ai.ready ? `AI aktywne · ${ai.model}` : "AI wymaga konfiguracji"}
        </strong>
      </header>

      <nav className={styles.tabs} aria-label="Tryb pracy OctopusAI">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.key;
          return (
            <Link
              key={tab.key}
              href={`${baseHref}?tab=${tab.key}`}
              className={`${styles.tab}${selected ? ` ${styles.tabActive}` : ""}`}
              aria-current={selected ? "page" : undefined}
            >
              <Icon size={15} aria-hidden="true" />
              {tab.label}
              {typeof tab.count === "number" && tab.count > 0 ? <span className={styles.tabBadge}>{tab.count}</span> : null}
            </Link>
          );
        })}
      </nav>

      {!storageReady || entriesResult.error ? (
        <section className="co-schema-warning" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>Część zaplecza AI jest chwilowo ograniczona.</strong>
            <span>
              {!storageReady ? "Dodawanie nowych źródeł jest zablokowane. " : ""}
              {entriesResult.error ? "Baza wiedzy chwilowo nie odpowiedziała." : ""}
            </span>
          </div>
        </section>
      ) : null}

      {activeTab === "decisions" ? (
        <section className={`${styles.panel} ${styles.decisionPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <p className="co-kicker">Do decyzji</p>
              <h2>Decyzje i wyjątki AI</h2>
              <p>Pokazujemy tylko elementy wymagające zatwierdzenia, korekty albo ponowienia.</p>
            </div>
            <div className={styles.panelHeadingActions}>
              <span className={styles.count}>{decisionItems.length} spraw</span>
              <Link href={`/workspace/companies/${workspace.id}/ai-inbox`} className="co-text-link">Pełna skrzynka AI →</Link>
            </div>
          </div>
          {decisionItems.length ? (
            <AiInbox
              items={decisionItems}
              workspaceId={workspace.id}
              currentUserId={user.id}
              projects={projects.map((project) => ({ id: project.id, name: project.name }))}
            />
          ) : (
            <div className={styles.emptyState}>
              <CheckCircle2 size={20} aria-hidden="true" />
              <div><strong>Brak decyzji do podjęcia.</strong><span>OctopusAI nie ma teraz wyjątków wymagających Twojej reakcji.</span></div>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "knowledge" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className="co-kicker">Wiedza</p>
              <h2>Biblioteka wiedzy firmy</h2>
              <p>Sprawdzone lekcje, rozwiązania, normy i ryzyka dostępne dla Octopus Brain.</p>
            </div>
            <span className={styles.count}>{approvedEntries} zatwierdzonych</span>
          </div>

          <details className={styles.addKnowledge}>
            <summary>
              <span className={styles.summaryLeft}>
                <Plus size={16} aria-hidden="true" />
                <strong>Dodaj sprawdzoną wiedzę</strong>
                <small>formularz jest domyślnie schowany</small>
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className={styles.formBody}>
              <KnowledgeEntryForm
                workspaceId={workspace.id}
                projects={projects.map((project) => ({ id: project.id, name: project.name }))}
              />
            </div>
          </details>

          {entries.length ? (
            <div className={styles.libraryList}>
              {entries.slice(0, 20).map((entry) => {
                const approved = entry.status === "approved";
                return (
                  <article key={entry.id} className={styles.entryCard}>
                    <span className={`${styles.entryIcon}${approved ? "" : ` ${styles.entryIconPending}`}`}>
                      {approved ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />}
                    </span>
                    <div className={styles.entryBody}>
                      <small>{entry.entry_type}</small>
                      <strong>{entry.title}</strong>
                      <p>{entry.summary}</p>
                      {Array.isArray(entry.tags) && entry.tags.length ? <span>{entry.tags.join(" · ")}</span> : null}
                    </div>
                    <span className={`${styles.status}${approved ? ` ${styles.statusApproved}` : ""}`}>
                      {approved ? "Zatwierdzona" : "Do kontroli"}
                    </span>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <BookOpenCheck size={20} aria-hidden="true" />
              <div><strong>Biblioteka jest jeszcze pusta.</strong><span>Dodaj pierwszy sprawdzony wpis, aby Brain mógł korzystać z wiedzy firmy.</span></div>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "templates" ? (
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className="co-kicker">Wzory</p>
              <h2>Wzory, szablony i źródła AI</h2>
              <p>Dodawaj materiały referencyjne i używaj zatwierdzonych wzorów do generowania dokumentów.</p>
            </div>
            <span className={styles.count}>{templateDocuments} plików wzorcowych</span>
          </div>

          <details className={styles.sourceDisclosure}>
            <summary>
              <span className={styles.summaryLeft}>
                <UploadCloud size={16} aria-hidden="true" />
                <strong>Źródła dla AI</strong>
                <small>{documents.length} dokumentów · rozwiń, aby dodać lub przejrzeć</small>
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className={styles.sourceBody}>
              <DocumentUpload
                workspaceId={workspace.id}
                projects={projects}
                documents={documents}
                trashedDocuments={trashedDocuments}
                storageReady={storageReady}
                defaultCategory="template"
              />
            </div>
          </details>

          <div className={styles.templateShell}>
            <TemplateStudio workspaceId={workspace.id} />
          </div>
        </section>
      ) : null}

      {activeTab === "search" ? (
        <section className={`${styles.panel} ${styles.searchPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <p className="co-kicker">Szukaj</p>
              <h2>Zapytaj Octopus Brain</h2>
              <p>Przeszukuj dokumenty, fakty i zatwierdzoną wiedzę firmy. Wynik zawsze pokazuje źródła.</p>
            </div>
            <span className={styles.count}>Źródła + wiedza firmy</span>
          </div>
          <KnowledgeSearch
            workspaceId={workspace.id}
            suggestions={[
              "Pokaż wzór wniosku urlopowego",
              "Znajdź procedurę BHP",
              "Jak wygląda próba szczelności?",
              "Pokaż dokumenty dotyczące kanalizacji"
            ]}
          />
        </section>
      ) : null}
    </main>
  );
}
