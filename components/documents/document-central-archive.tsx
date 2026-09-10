"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  FileSearch,
  FileText,
  FolderKanban,
  Search,
  ShieldAlert,
  Sparkles
} from "lucide-react";
import { AiInbox } from "@/components/brain/ai-inbox";
import { DocumentOpenLink } from "@/components/documents/document-open-link";
import { documentCategoryLabel } from "@/lib/documents/classification";
import type { DocumentLibraryInsight } from "@/lib/documents/library-types";
import type { AiInboxItem } from "@/lib/data/operations";
import type { DocumentSummary } from "@/lib/types";
import styles from "./document-central-archive.module.css";

type ProjectOption = { id: string; name: string };
type ArchiveTabId = "all" | "review" | "investments" | "finance" | "warehouse" | "hr" | "fleet" | "templates" | "company" | "unassigned";

type Props = {
  workspaceId: string;
  documents: DocumentSummary[];
  projects: ProjectOption[];
  insights: DocumentLibraryInsight[];
  reviewItems: AiInboxItem[];
  currentUserId: string;
  uploadContent: ReactNode;
};

const MODULE_LABELS: Record<Exclude<ArchiveTabId, "all" | "review">, string> = {
  investments: "Inwestycje",
  finance: "Finanse",
  warehouse: "Magazyn",
  hr: "Kadry",
  fleet: "Flota",
  templates: "Wzory i Brain",
  company: "Ogólne firmy",
  unassigned: "Nieprzypisane"
};

const TABS: Array<{ id: ArchiveTabId; label: string }> = [
  { id: "all", label: "Wszystkie" },
  { id: "review", label: "Do weryfikacji" },
  { id: "investments", label: "Inwestycje" },
  { id: "finance", label: "Finanse" },
  { id: "warehouse", label: "Magazyn" },
  { id: "hr", label: "Kadry" },
  { id: "fleet", label: "Flota" },
  { id: "templates", label: "Wzory i Brain" },
  { id: "company", label: "Ogólne" },
  { id: "unassigned", label: "Nieprzypisane" }
];

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .toLocaleLowerCase("pl");
}

function moduleForDocument(document: DocumentSummary): Exclude<ArchiveTabId, "all" | "review"> {
  const category = normalize(document.flow?.category ?? document.category);
  if (["invoice", "finance", "payment", "cost"].includes(category)) return "finance";
  if (["warehouse", "delivery note", "delivery_note", "stock", "material"].includes(category)) return "warehouse";
  if (["hr", "timesheet", "employee", "leave"].includes(category)) return "hr";
  if (["fleet", "equipment", "vehicle"].includes(category)) return "fleet";
  if (["template", "reference", "brain"].includes(category)) return "templates";
  if (document.project_id) return "investments";

  const clue = normalize(`${document.name} ${document.category ?? ""} ${document.flow?.destination ?? ""}`);
  if (/faktur|finans|platn|ksieg|koszt/.test(clue)) return "finance";
  if (/magaz|warehouse|wz|pz|material/.test(clue)) return "warehouse";
  if (/kadr|pracownik|bhp|urlop|timesheet/.test(clue)) return "hr";
  if (/flot|pojazd|samoch|vehicle|equipment/.test(clue)) return "fleet";
  if (/wzor|szablon|template|brain|referency/.test(clue)) return "templates";
  if (/inwest|projekt|boq|wbs|protokol|harmonogram|rysun/.test(clue)) return "investments";
  if (/firma|firmow|company|ogoln/.test(clue)) return "company";
  return "unassigned";
}

function requiresReview(document: DocumentSummary) {
  return document.flow?.stage === "review" || document.ai_status === "review" || moduleForDocument(document) === "unassigned";
}

function stageLabel(document: DocumentSummary) {
  const stage = document.flow?.stage;
  if (stage === "ready") return "Gotowe";
  if (stage === "review") return "Do weryfikacji";
  if (stage === "classified") return "Rozpoznano";
  if (stage === "processing") return "Analiza w toku";
  if (stage === "error") return "Błąd AI";
  return "Wgrano";
}

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function confidence(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

function extractionMethodLabel(method: string | null | undefined) {
  if (!method) return "Brak indeksu tekstowego";
  if (method.includes("warehouse")) return "Gemini / OCR dokumentu biznesowego";
  if (method.includes("gemini")) return "Gemini / OCR";
  if (method.includes("local")) return "Ekstrakcja lokalna / inline AI";
  return method;
}

export function DocumentCentralArchive({ workspaceId, documents, projects, insights, reviewItems, currentUserId, uploadContent }: Props) {
  const [tab, setTab] = useState<ArchiveTabId>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);

  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const insightByDocument = useMemo(() => new Map(insights.map((insight) => [insight.documentId, insight])), [insights]);
  const reviewByDocument = useMemo(() => new Map(reviewItems.map((item) => [item.id, item])), [reviewItems]);

  const counts = useMemo(() => new Map(TABS.map((item) => [item.id, documents.filter((document) => {
    if (item.id === "all") return false;
    if (item.id === "review") return requiresReview(document);
    return moduleForDocument(document) === item.id;
  }).length])), [documents]);

  const filteredDocuments = useMemo(() => {
    const needle = normalize(query.trim());
    return documents.filter((document) => {
      const matchesTab = tab === "review" ? requiresReview(document) : moduleForDocument(document) === tab;
      if (!matchesTab) return false;
      if (!needle) return true;
      const insight = insightByDocument.get(document.id);
      const projectName = document.project_id ? projectNames.get(document.project_id) ?? "" : "";
      const facts = insight?.facts.map((fact) => `${fact.label} ${fact.value} ${fact.unit ?? ""}`).join(" ") ?? "";
      const proposals = insight?.proposals.map((proposal) => `${proposal.module} ${proposal.title}`).join(" ") ?? "";
      const haystack = normalize([
        document.name,
        document.category,
        document.flow?.category,
        document.flow?.destination,
        document.flow?.rationale,
        projectName,
        insight?.summary,
        insight?.textPreview,
        facts,
        proposals
      ].filter(Boolean).join(" "));
      return haystack.includes(needle);
    });
  }, [documents, insightByDocument, projectNames, query, tab]);

  const selected = filteredDocuments.find((document) => document.id === selectedId) ?? filteredDocuments[0] ?? null;
  const selectedInsight = selected ? insightByDocument.get(selected.id) ?? null : null;
  const selectedReviewItem = selected ? reviewByDocument.get(selected.id) ?? null : null;
  const selectedVersion = selected
    ? selected.document_versions?.find((version) => version.id === selected.current_version_id) ?? selected.document_versions?.[0] ?? null
    : null;
  const selectedModule = selected ? moduleForDocument(selected) : null;
  const fallbackHref = selected
    ? selected.project_id
      ? `/workspace/projects/${selected.project_id}/documentation#document-${selected.id}`
      : `#document-${selected.id}`
    : "#";

  return (
    <div className={styles.archive} data-document-central-archive="1">
      <div className={styles.tabs} role="tablist" aria-label="Kategorie centralnego archiwum">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? styles.activeTab : undefined} onClick={() => setTab(item.id)}>
            {item.label}{item.id === "all" ? null : <span>{counts.get(item.id) ?? 0}</span>}
          </button>
        ))}
      </div>

      {tab === "all" ? (
        <div className={styles.uploadHome} data-documents-upload-home="1">
          {uploadContent}
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.searchBox}>
              <Search size={17} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Szukaj po nazwie, treści OCR, faktach AI, inwestycji lub module…"
                aria-label="Szukaj w centralnym archiwum dokumentów"
              />
            </div>
            <div className={styles.summary}><FileSearch size={16} /><strong>{filteredDocuments.length}</strong><span>z {documents.length} dokumentów</span></div>
          </div>

          {filteredDocuments.length ? (
            <div className={styles.archiveGrid}>
              <div className={styles.list} aria-label="Lista dokumentów">
                {filteredDocuments.map((document) => {
                  const insight = insightByDocument.get(document.id);
                  const moduleId = moduleForDocument(document);
                  const isSelected = selected?.id === document.id;
                  const isReview = requiresReview(document);
                  return (
                    <button
                      key={document.id}
                      type="button"
                      className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
                      onClick={() => setSelectedId(document.id)}
                      aria-pressed={isSelected}
                    >
                      <span className={styles.fileIcon}><FileText size={18} aria-hidden="true" /></span>
                      <span className={styles.rowBody}>
                        <strong>{document.name}</strong>
                        <small>{document.project_id ? projectNames.get(document.project_id) ?? "Inwestycja" : MODULE_LABELS[moduleId]} · {documentCategoryLabel(document.flow?.category ?? document.category)}</small>
                        {insight?.summary ? <em>{insight.summary}</em> : null}
                      </span>
                      <span className={styles.rowState}>
                        <span className={`${styles.stage} ${isReview ? styles.stageReview : document.flow?.stage === "error" ? styles.stageError : document.flow?.stage === "ready" ? styles.stageReady : ""}`}>{stageLabel(document)}</span>
                        <small>{document.updated_at ? new Date(document.updated_at).toLocaleDateString("pl-PL") : ""}</small>
                      </span>
                    </button>
                  );
                })}
              </div>

              {selected ? (
                <aside className={styles.details} aria-label={`Szczegóły dokumentu ${selected.name}`} data-document-ai-ocr="1">
                  <div className={styles.detailsHeading}>
                    <div><span className={styles.kicker}>Dokument źródłowy</span><h3>{selected.name}</h3><p>{selected.project_id ? projectNames.get(selected.project_id) ?? "Inwestycja" : selectedModule ? MODULE_LABELS[selectedModule] : "Dokument firmy"}</p></div>
                    <span className={`${styles.stage} ${requiresReview(selected) ? styles.stageReview : selected.flow?.stage === "error" ? styles.stageError : selected.flow?.stage === "ready" ? styles.stageReady : ""}`}>{stageLabel(selected)}</span>
                  </div>

                  <div className={styles.actions}>
                    <DocumentOpenLink workspaceId={workspaceId} projectId={selected.project_id} versionId={selectedVersion?.id ?? selected.current_version_id} fallbackHref={fallbackHref} />
                    {selected.flow?.resultHref ? <Link href={selected.flow.resultHref}>Przejdź do modułu →</Link> : null}
                    {requiresReview(selected) ? <a href={`#document-review-${selected.id}`}>Podejmij decyzję ↓</a> : null}
                  </div>

                  {requiresReview(selected) && selectedReviewItem ? (
                    <section className={styles.aiPanel} id={`document-review-${selected.id}`} aria-label={`Decyzja dla dokumentu ${selected.name}`}>
                      <div className={styles.panelTitle}><ShieldAlert size={17} /><div><strong>Decyzja wymagana</strong><span>Popraw kategorię lub inwestycję, a następnie zatwierdź albo odrzuć dokument.</span></div></div>
                      <AiInbox
                        items={[selectedReviewItem]}
                        workspaceId={workspaceId}
                        currentUserId={currentUserId}
                        projects={projects}
                      />
                    </section>
                  ) : null}

                  <div className={styles.metaGrid}>
                    <div><span>Kategoria AI</span><strong>{documentCategoryLabel(selected.flow?.category ?? selected.category)}</strong></div>
                    <div><span>Pewność</span><strong>{confidence(selected.flow?.confidence ?? selected.ai_confidence)}</strong></div>
                    <div><span>Wersja</span><strong>{selectedVersion ? `v${selectedVersion.version_number}` : "—"}</strong></div>
                    <div><span>Rozmiar</span><strong>{formatBytes(selectedVersion?.file_size_bytes)}</strong></div>
                    <div><span>Ekstrakcja</span><strong>{extractionMethodLabel(selectedInsight?.extractionMethod)}</strong></div>
                    <div><span>Indeks</span><strong>{selectedInsight?.characterCount ? `${selectedInsight.characterCount.toLocaleString("pl-PL")} znaków` : "—"}</strong></div>
                  </div>

                  <section className={styles.aiPanel}>
                    <div className={styles.panelTitle}><Sparkles size={17} /><div><strong>Co odczytał Octopus AI / OCR</strong><span>Ten sam wynik analizy jest używany przez routing i moduły docelowe.</span></div></div>
                    {selectedInsight?.summary ? <p className={styles.summaryText}>{selectedInsight.summary}</p> : <p className={styles.emptyPanel}>Analiza nie zapisała jeszcze podsumowania dla tej wersji.</p>}
                    {selected.flow?.rationale ? <p className={styles.rationale}><strong>Uzasadnienie klasyfikacji:</strong> {selected.flow.rationale}</p> : null}
                    {selectedInsight?.facts.length ? (
                      <div className={styles.facts}>
                        {selectedInsight.facts.map((fact, index) => <div key={`${fact.label}-${index}`}><span>{fact.label}</span><strong>{fact.value}{fact.unit ? ` ${fact.unit}` : ""}</strong><small>{fact.confidence == null ? "" : `pewność ${confidence(fact.confidence)}`}</small></div>)}
                      </div>
                    ) : null}
                  </section>

                  <section className={styles.textPanel}>
                    <div className={styles.panelTitle}><BrainCircuit size={17} /><div><strong>Tekst / indeks OCR</strong><span>{selectedInsight?.pageCount ? `${selectedInsight.pageCount} str. · ` : ""}{selectedInsight?.qualityScore != null ? `jakość ${confidence(selectedInsight.qualityScore)}` : "pełny oryginał pozostaje w R2"}</span></div></div>
                    {selectedInsight?.textPreview ? <pre>{selectedInsight.textPreview}</pre> : <p className={styles.emptyPanel}>Brak tekstowego podglądu. Dla skanów i obrazów fakty mogą pochodzić bezpośrednio z analizy multimodalnej.</p>}
                  </section>

                  <section className={styles.modulesPanel}>
                    <div className={styles.panelTitle}><FolderKanban size={17} /><div><strong>Zasilanie modułów</strong><span>Propozycje utworzone z tego samego dokumentu — bez duplikowania pliku.</span></div></div>
                    {selectedInsight?.proposals.length ? (
                      <div className={styles.proposals}>{selectedInsight.proposals.map((proposal, index) => <div key={`${proposal.module}-${proposal.title}-${index}`}><span>{proposal.module}</span><strong>{proposal.title}</strong><small>{proposal.status}{proposal.confidence == null ? "" : ` · ${confidence(proposal.confidence)}`}</small></div>)}</div>
                    ) : selected.flow?.destination ? <p className={styles.routeLine}><CheckCircle2 size={15} /> Routing: <strong>{selected.flow.destination}</strong> · {selected.flow.outcome}</p> : <p className={styles.emptyPanel}>Brak aktywnych propozycji modułowych dla tej wersji.</p>}
                  </section>

                  {selectedInsight?.warnings.length ? (
                    <section className={styles.warningPanel}><div className={styles.panelTitle}><ShieldAlert size={17} /><strong>Uwagi analizy</strong></div><ul>{selectedInsight.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></section>
                  ) : null}
                </aside>
              ) : null}
            </div>
          ) : (
            <div className={styles.empty}>
              <AlertTriangle size={24} aria-hidden="true" />
              <strong>Brak dokumentów pasujących do tego widoku.</strong>
              <span>Zmień zakładkę albo wyczyść wyszukiwanie.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
