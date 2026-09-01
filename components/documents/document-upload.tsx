"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FilePlus2,
  FileSearch,
  FileText,
  FolderOpen,
  Info,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UploadCloud
} from "lucide-react";
import type { DocumentFlowStage, DocumentSummary, ProjectSummary } from "@/lib/types";
import { DOCUMENT_DESTINATIONS, documentCategoryLabel } from "@/lib/documents/classification";
import { MAX_SUPPORTED_UPLOAD_BYTES, SUPPORTED_UPLOAD_ACCEPT, validateUploadFile } from "@/lib/r2/sanitize";
import styles from "./document-flow-200.module.css";

type DocumentUploadProps = {
  workspaceId?: string;
  projectId?: string;
  projects?: ProjectSummary[];
  documents: DocumentSummary[];
  trashedDocuments: DocumentSummary[];
  storageReady: boolean;
  defaultCategory?: string;
};
type UploadResponse = { uploadUrl: string; token: string; headers: Record<string, string> };
type DownloadResponse = { downloadUrl: string };
type CompleteResponse = { documentId: string; versionId: string; versionNumber: number };
type AnalysisResponse = {
  alreadyAnalyzed?: boolean;
  message?: string;
  analysis?: { package?: { accepted?: number; rejected?: number; queuedVersionIds?: string[] } };
  materialization?: { destination?: string | null; status?: string; entityType?: string | null; entityId?: string | null };
};
type UploadCandidate = { file: File; relativePath: string };
type BrowserFileEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
  file?: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
  createReader?: () => { readEntries: (success: (entries: BrowserFileEntry[]) => void, failure?: (error: DOMException) => void) => void };
};

const MAX_BROWSER_HASH_BYTES = 32 * 1024 * 1024;
const MAX_FOLDER_FILES = 1000;
const IGNORED_FOLDER_ARTIFACTS = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}
function candidateFromFile(file: File): UploadCandidate {
  const browserFile = file as File & { webkitRelativePath?: string };
  return { file, relativePath: normalizeRelativePath(browserFile.webkitRelativePath?.trim() || file.name) };
}
function folderPathForCandidate(candidate: UploadCandidate) {
  const parts = normalizeRelativePath(candidate.relativePath).split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;
}
function shouldIgnoreFolderArtifact(candidate: UploadCandidate) {
  const parts = normalizeRelativePath(candidate.relativePath).split("/").filter(Boolean);
  return IGNORED_FOLDER_ARTIFACTS.has(candidate.file.name) || parts.includes("__MACOSX");
}
function fileFromEntry(entry: BrowserFileEntry) {
  return new Promise<File>((resolve, reject) => {
    if (!entry.file) return reject(new Error(`Nie można odczytać pliku ${entry.name}.`));
    entry.file(resolve, reject);
  });
}
async function readDirectoryEntries(entry: BrowserFileEntry) {
  if (!entry.createReader) return [] as BrowserFileEntry[];
  const reader = entry.createReader();
  const collected: BrowserFileEntry[] = [];
  while (true) {
    const batch = await new Promise<BrowserFileEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    collected.push(...batch);
  }
  return collected;
}
async function candidatesFromEntry(entry: BrowserFileEntry, parentPath = ""): Promise<UploadCandidate[]> {
  const entryPath = normalizeRelativePath(entry.fullPath || [parentPath, entry.name].filter(Boolean).join("/"));
  if (entry.isFile) {
    const file = await fileFromEntry(entry);
    return [{ file, relativePath: entryPath || file.name }];
  }
  if (!entry.isDirectory) return [];
  const children = await readDirectoryEntries(entry);
  return (await Promise.all(children.map((child) => candidatesFromEntry(child, entryPath)))).flat();
}
async function candidatesFromDataTransfer(dataTransfer: DataTransfer) {
  const roots: BrowserFileEntry[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    const getter = (item as unknown as { webkitGetAsEntry?: () => BrowserFileEntry | null }).webkitGetAsEntry;
    const entry = getter?.call(item);
    if (entry) roots.push(entry);
  }
  if (!roots.length) return Array.from(dataTransfer.files ?? []).map(candidateFromFile);
  return (await Promise.all(roots.map((entry) => candidatesFromEntry(entry)))).flat();
}
function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
async function sha256ForSmallFile(file: File) {
  if (file.size > MAX_BROWSER_HASH_BYTES) return null;
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function aiStateLabel(status: string | null | undefined) {
  if (status === "ready") return "AI: przeanalizowano";
  if (status === "review") return "AI: wymaga weryfikacji";
  if (["processing", "running"].includes(status ?? "")) return "AI: analiza w toku";
  if (["error", "failed"].includes(status ?? "")) return "AI: błąd analizy";
  return "AI: oczekuje na analizę";
}
function stageLabel(stage: DocumentFlowStage | undefined) {
  if (stage === "ready") return "Gotowe";
  if (stage === "review") return "Do decyzji";
  if (stage === "classified") return "Rozpoznano";
  if (stage === "processing") return "W toku";
  if (stage === "error") return "Błąd";
  return "Wgrano";
}
function stageClass(stage: DocumentFlowStage | undefined) {
  if (stage === "ready") return styles.stageReady;
  if (stage === "review") return styles.stageReview;
  if (stage === "error") return styles.stageError;
  if (stage === "processing") return styles.stageProcessing;
  return "";
}
function flowCellClass(stage: DocumentFlowStage | undefined) {
  if (stage === "ready") return styles.flowReady;
  if (stage === "review") return styles.flowReview;
  if (stage === "error") return styles.flowError;
  if (stage === "processing") return styles.flowProcessing;
  return "";
}
function confidenceLabel(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

export function DocumentUpload({
  workspaceId,
  projectId,
  projects = [],
  documents,
  trashedDocuments,
  storageReady,
  defaultCategory = ""
}: DocumentUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetDocumentIdRef = useRef<string | null>(null);
  const targetProjectIdRef = useRef<string | null>(projectId ?? null);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [uploadCategory, setUploadCategory] = useState(defaultCategory);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedFlowId, setExpandedFlowId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categories = useMemo(
    () => Array.from(new Set(documents.map((document) => document.category).filter(Boolean))).sort() as string[],
    [documents]
  );
  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pl");
    return documents.filter((document) => {
      const flowCategory = document.flow?.category ?? document.category ?? "";
      const matchesText = !normalized
        || document.name.toLocaleLowerCase("pl").includes(normalized)
        || flowCategory.toLocaleLowerCase("pl").includes(normalized)
        || (document.flow?.destination ?? "").toLocaleLowerCase("pl").includes(normalized);
      return matchesText && (category === "all" || flowCategory === category);
    });
  }, [category, documents, query]);

  async function uploadFile(candidate: UploadCandidate, documentId: string | null, contextProjectId: string | null) {
    const { file } = candidate;
    setError(null);
    const validationError = validateUploadFile(file.name, file.type || "application/octet-stream", file.size);
    if (validationError) throw new Error(validationError);
    setStatus(file.size <= MAX_BROWSER_HASH_BYTES ? "Obliczanie sumy kontrolnej" : `Przygotowywanie pliku (limit ${MAX_SUPPORTED_UPLOAD_BYTES / 1024 / 1024} MB)`);
    const digest = await sha256ForSmallFile(file);
    const mimeType = file.type || "application/octet-stream";
    const prepareResponse = await fetch("/api/storage/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        projectId: contextProjectId,
        documentId,
        fileName: file.name,
        mimeType,
        fileSize: file.size,
        category: uploadCategory || undefined,
        categoryLocked: Boolean(uploadCategory),
        packageLabel: folderPathForCandidate(candidate)
      })
    });
    if (!prepareResponse.ok) {
      const payload = await prepareResponse.json().catch(() => null);
      throw new Error(payload?.error ?? "Nie udało się wygenerować adresu uploadu.");
    }
    const upload = await prepareResponse.json() as UploadResponse;
    setStatus("Wysyłanie pliku do prywatnego R2");
    const putResponse = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: file });
    if (!putResponse.ok) throw new Error(`R2 odrzucił upload: HTTP ${putResponse.status}`);

    setStatus("Zapisywanie dokumentu i uruchamianie Document Flow 2.0");
    const completeResponse = await fetch("/api/storage/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: upload.token, sha256: digest })
    });
    if (!completeResponse.ok) {
      const payload = await completeResponse.json().catch(() => null);
      throw new Error(payload?.error ?? "Nie udało się zapisać dokumentu.");
    }
    const completed = await completeResponse.json() as CompleteResponse;

    if (file.size <= 32 * 1024 * 1024) {
      setStatus("Dokument zapisany — Octopus Brain analizuje i wybiera miejsce docelowe");
      const analysisResponse = await fetch("/api/brain/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, versionId: completed.versionId })
      });
      const analysisPayload = await analysisResponse.json().catch(() => ({})) as AnalysisResponse;
      const packageInfo = analysisPayload.analysis?.package;
      if (analysisResponse.ok && packageInfo) {
        const immediate = (packageInfo.queuedVersionIds ?? []).slice(0, 3);
        setStatus(`Paczka rozpakowana: ${packageInfo.accepted ?? 0} plików przyjętych, ${packageInfo.rejected ?? 0} odrzuconych. Uruchamiam pierwsze analizy.`);
        await Promise.allSettled(immediate.map((versionId) => fetch("/api/brain/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, versionId })
        })));
        setStatus(`Paczka gotowa — ${packageInfo.accepted ?? 0} dokumentów ma osobne zadania AI.`);
      } else {
        setStatus(analysisResponse.ok
          ? (analysisPayload.message ?? "Analiza i routing zakończone")
          : "Dokument zapisany — analiza pozostaje w kolejce");
      }
    } else {
      setStatus("Dokument zapisany — duży plik oczekuje w kolejce workera");
    }
    startTransition(() => router.refresh());
  }

  async function handleCandidates(candidates: UploadCandidate[]) {
    if (!storageReady) return;
    const selectedFiles = candidates.filter((candidate) => !shouldIgnoreFolderArtifact(candidate));
    if (!selectedFiles.length) {
      setError("Folder nie zawiera obsługiwanych plików do przesłania.");
      return;
    }
    if (selectedFiles.length > MAX_FOLDER_FILES) {
      setError(`Jednorazowo możesz przekazać maksymalnie ${MAX_FOLDER_FILES} plików. Podziel dokumentację na mniejsze foldery.`);
      return;
    }
    if (targetDocumentIdRef.current && selectedFiles.length > 1) {
      setError("Nowa wersja dokumentu może zawierać jeden plik. Dla folderu użyj głównej Wrzutni.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setIsUploading(true);
    setError(null);
    const failures: string[] = [];
    let completed = 0;
    const hasFolderStructure = selectedFiles.some((candidate) => candidate.relativePath.includes("/"));
    for (const [index, candidate] of selectedFiles.entries()) {
      try {
        setStatus(`Plik ${index + 1} z ${selectedFiles.length}: ${candidate.relativePath}`);
        await uploadFile(candidate, targetDocumentIdRef.current, targetProjectIdRef.current);
        completed += 1;
      } catch (uploadError) {
        failures.push(`${candidate.relativePath}: ${uploadError instanceof Error ? uploadError.message : "upload nie powiódł się"}`);
      }
    }
    if (completed) setStatus(`Zapisano ${completed} z ${selectedFiles.length} plików${hasFolderStructure ? " z zachowaniem informacji o folderach" : ""}. Document Flow działa w tle.`);
    if (failures.length) setError(failures.join(" · "));
    if (!completed) setStatus(null);
    try {
      startTransition(() => router.refresh());
    } finally {
      setIsUploading(false);
      targetDocumentIdRef.current = null;
      targetProjectIdRef.current = projectId ?? (selectedProjectId || null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleFiles(files: FileList | null) {
    await handleCandidates(Array.from(files ?? []).map(candidateFromFile));
  }
  async function handleDrop(dataTransfer: DataTransfer) {
    if (!storageReady) return;
    try {
      setStatus("Odczytywanie struktury folderów");
      await handleCandidates(await candidatesFromDataTransfer(dataTransfer));
    } catch (dropError) {
      setStatus(null);
      setError(dropError instanceof Error ? dropError.message : "Nie udało się odczytać przeciągniętego folderu.");
    }
  }
  function openFilePicker(documentId: string | null = null, contextProjectId: string | null = selectedProjectId || null) {
    targetDocumentIdRef.current = documentId;
    targetProjectIdRef.current = projectId ?? contextProjectId;
    if (inputRef.current) {
      inputRef.current.removeAttribute("webkitdirectory");
      inputRef.current.removeAttribute("directory");
      inputRef.current.click();
    }
  }
  function openFolderPicker() {
    targetDocumentIdRef.current = null;
    targetProjectIdRef.current = projectId ?? (selectedProjectId || null);
    if (inputRef.current) {
      inputRef.current.setAttribute("webkitdirectory", "");
      inputRef.current.setAttribute("directory", "");
      inputRef.current.click();
    }
  }

  async function getDocumentUrl(versionId: string, contextProjectId: string | null, disposition: "attachment" | "inline") {
    const response = await fetch("/api/storage/download-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, projectId: contextProjectId, versionId, disposition })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? (disposition === "inline" ? "Nie udało się przygotować podglądu." : "Nie udało się przygotować pobierania."));
    }
    return (await response.json() as DownloadResponse).downloadUrl;
  }
  async function downloadVersion(versionId: string, contextProjectId: string | null) {
    setError(null);
    setStatus("Przygotowywanie pobierania");
    try {
      const url = await getDocumentUrl(versionId, contextProjectId, "attachment");
      setStatus(null);
      window.location.assign(url);
    } catch (downloadError) {
      setStatus(null);
      setError(downloadError instanceof Error ? downloadError.message : "Pobieranie nie powiodło się.");
    }
  }
  async function previewVersion(versionId: string, contextProjectId: string | null) {
    setError(null);
    setStatus("Przygotowywanie podglądu");
    const previewWindow = window.open("about:blank", "_blank");
    if (previewWindow) previewWindow.opener = null;
    try {
      const url = await getDocumentUrl(versionId, contextProjectId, "inline");
      setStatus(null);
      if (previewWindow) previewWindow.location.replace(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (previewError) {
      previewWindow?.close();
      setStatus(null);
      setError(previewError instanceof Error ? previewError.message : "Podgląd nie powiódł się.");
    }
  }
  async function analyzeVersion(versionId: string) {
    setError(null);
    setStatus("Octopus Brain sprawdza analizę i routing dokumentu");
    try {
      const response = await fetch("/api/brain/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, versionId })
      });
      const payload = await response.json().catch(() => ({})) as AnalysisResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Nie udało się uruchomić analizy.");
      setStatus(payload.message ?? (payload.alreadyAnalyzed
        ? "Document Flow sprawdził istniejącą analizę i dokończył routing."
        : "Analiza AI zakończona — wynik jest gotowy do użycia."));
      startTransition(() => router.refresh());
    } catch (analysisError) {
      setStatus(null);
      setError(analysisError instanceof Error ? analysisError.message : "Analiza nie powiodła się.");
    }
  }
  async function changeDocumentState(documentId: string, state: "active" | "trashed", contextProjectId: string | null) {
    setError(null);
    setStatus(state === "trashed" ? "Przenoszenie dokumentu do kosza" : "Przywracanie dokumentu");
    try {
      const response = await fetch("/api/storage/document-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, projectId: contextProjectId, documentId, state })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Nie udało się zmienić stanu dokumentu.");
      }
      setStatus(state === "trashed" ? "Dokument przeniesiony do kosza" : "Dokument przywrócony");
      startTransition(() => router.refresh());
    } catch (stateError) {
      setStatus(null);
      setError(stateError instanceof Error ? stateError.message : "Zmiana stanu dokumentu nie powiodła się.");
    }
  }

  return (
    <div className={styles.workspace} data-document-flow-v2="1">
      <details className={styles.uploader}>
        <summary>
          <span className={styles.summaryLeft}>
            <UploadCloud size={16} aria-hidden="true" />
            <strong>Wrzutnia</strong>
            <small>PDF, Word, Excel, obraz, XML lub ZIP → AI → właściwy moduł</small>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className={styles.uploaderBody}>
          <input
            ref={inputRef}
            type="file"
            accept={SUPPORTED_UPLOAD_ACCEPT}
            multiple
            hidden
            onChange={(event) => void handleFiles(event.target.files)}
            disabled={!storageReady}
          />
          <div className={styles.uploadSettings}>
            {!projectId && projects.length > 0 ? (
              <label>
                <span>Kontekst nowego dokumentu</span>
                <select value={selectedProjectId} onChange={(event) => {
                  setSelectedProjectId(event.target.value);
                  targetProjectIdRef.current = event.target.value || null;
                }}>
                  <option value="">Dokument firmowy / AI dopasuje</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              <span>Rodzaj nowego źródła</span>
              <select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)}>
                <option value="">AI rozpozna automatycznie</option>
                {DOCUMENT_DESTINATIONS.map((destination) => <option key={destination.value} value={destination.value}>{destination.label}</option>)}
              </select>
            </label>
          </div>
          <button
            type="button"
            className={`${styles.dropzone}${isDragging ? ` ${styles.dropzoneActive}` : ""}`}
            onClick={() => openFilePicker()}
            onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => { event.preventDefault(); setIsDragging(false); void handleDrop(event.dataTransfer); }}
            disabled={isPending || isUploading || !storageReady}
          >
            <UploadCloud size={26} aria-hidden="true" />
            <span className={styles.dropzoneText}>
              <strong>{isUploading ? "Przetwarzanie dokumentacji" : "Przeciągnij pliki albo kliknij, aby wybrać"}</strong>
              <span>Obsługiwane foldery i podfoldery · do {MAX_SUPPORTED_UPLOAD_BYTES / 1024 / 1024} MB na plik</span>
            </span>
          </button>
          <div className={styles.uploadActions}>
            <button type="button" className="secondary-button" onClick={openFolderPicker} disabled={isPending || isUploading || !storageReady}>
              <FolderOpen size={15} aria-hidden="true" />Wybierz folder
            </button>
            <div className={styles.pipeline}><span>R2</span><span>Ekstrakcja</span><span>Gemini</span><span>Klasyfikacja</span><span>Routing</span><span>Moduł</span></div>
          </div>
          {!storageReady ? <p className={`${styles.message} ${styles.error}`}>Zaplecze Wrzutni wymaga aktualnych migracji.</p> : null}
          {status ? <p className={styles.message}>{status}</p> : null}
          {error ? <p className={`${styles.message} ${styles.error}`}>{error}</p> : null}
        </div>
      </details>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj po nazwie, kategorii, celu lub module" />
        </label>
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Kategoria dokumentu">
          <option value="all">Wszystkie kategorie</option>
          {categories.map((item) => <option key={item} value={item}>{documentCategoryLabel(item)}</option>)}
        </select>
        <span className={styles.count}>{filteredDocuments.length} / {documents.length}</span>
      </div>

      {status && !isUploading ? <p className={styles.message}>{status}</p> : null}
      {error ? <p className={`${styles.message} ${styles.error}`}>{error}</p> : null}

      <div className={styles.list}>
        {filteredDocuments.length > 0 ? filteredDocuments.map((document) => {
          const version = document.document_versions?.[0];
          const projectName = projects.find((item) => item.id === document.project_id)?.name;
          const quarantined = version?.malware_scan_status === "infected";
          const flow = document.flow;
          const recognizedCategory = flow?.category ?? document.category;
          const recognized = recognizedCategory
            ? `${documentCategoryLabel(recognizedCategory)} · ${confidenceLabel(flow?.confidence ?? document.ai_confidence)}`
            : "Oczekuje na klasyfikację";
          const destination = flow?.destination ?? (recognizedCategory
            ? (DOCUMENT_DESTINATIONS.find((item) => item.value === recognizedCategory)?.destination ?? "Dokumenty → Do decyzji")
            : "Jeszcze nie wybrano");
          const outcome = flow?.outcome ?? aiStateLabel(document.ai_status);
          const detailsOpen = expandedFlowId === document.id;
          const hasAnalysis = Boolean(flow?.category || document.ai_status === "ready" || document.ai_status === "review");
          const shouldRoute = flow?.stage === "classified";
          const decisionHref = workspaceId ? `/workspace/companies/${workspaceId}/ai-inbox` : null;

          return (
            <article key={document.id} id={`document-${document.id}`} className={styles.card}>
              <div className={styles.identity}>
                <div className={styles.titleLine}>
                  <FileText size={17} aria-hidden="true" />
                  <h3>{document.name}</h3>
                  <span className={styles.category}>{documentCategoryLabel(recognizedCategory)}</span>
                </div>
                <p className={styles.meta}>
                  {projectName ?? (document.project_id ? "Inwestycja" : "Dokument firmowy")} · {version?.mime_type ?? "plik"} · {version ? formatFileSize(version.file_size_bytes) : "bez wersji"} · {version ? `v${version.version_number}` : "oczekuje"}
                </p>
                <span className={`${styles.stage} ${stageClass(flow?.stage)}`}>
                  {flow?.stage === "ready" ? <CheckCircle2 size={12} aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />}
                  {stageLabel(flow?.stage)}
                </span>
                {quarantined ? <span className={`${styles.security} ${styles.securityBad}`}>Kwarantanna · dostęp do pliku zablokowany</span> : version?.malware_scan_status === "clean" ? <span className={styles.security}>Skan bezpieczeństwa: czysty</span> : null}
              </div>

              <div className={styles.flow} aria-label="Przepływ dokumentu">
                <div className={`${styles.flowCell} ${flowCellClass(flow?.stage)}`}>
                  <span>Rozpoznano</span>
                  <strong title={recognized}>{recognized}</strong>
                </div>
                <div className={`${styles.flowCell} ${flowCellClass(flow?.stage)}`}>
                  <span>Cel</span>
                  <strong title={destination}>{destination}</strong>
                </div>
                <div className={`${styles.flowCell} ${flowCellClass(flow?.stage)}`}>
                  <span>Wynik</span>
                  <strong title={outcome}>{outcome}</strong>
                </div>
              </div>

              {version ? (
                <div className={styles.actions}>
                  {flow?.stage === "processing" ? (
                    <button type="button" className="secondary-button" disabled><Sparkles size={14} aria-hidden="true" />Analizuję…</button>
                  ) : hasAnalysis && flow?.stage !== "error" ? (
                    <button type="button" className="secondary-button" onClick={() => setExpandedFlowId(detailsOpen ? null : document.id)}>
                      <Info size={14} aria-hidden="true" />Szczegóły AI
                    </button>
                  ) : (
                    <button type="button" className="secondary-button" onClick={() => void analyzeVersion(version.id)} disabled={isUploading}>
                      <Sparkles size={14} aria-hidden="true" />{flow?.stage === "error" ? "Ponów analizę" : "Analizuj"}
                    </button>
                  )}
                  {shouldRoute ? (
                    <button type="button" className="secondary-button" onClick={() => void analyzeVersion(version.id)} disabled={isUploading}>
                      <Sparkles size={14} aria-hidden="true" />Dokończ routing
                    </button>
                  ) : null}
                  <button type="button" className="secondary-button" onClick={() => void previewVersion(version.id, document.project_id)} disabled={isUploading || quarantined}>
                    <Eye size={14} aria-hidden="true" />Podgląd
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void downloadVersion(version.id, document.project_id)} disabled={isUploading || quarantined}>
                    <Download size={14} aria-hidden="true" />Pobierz
                  </button>
                  <button type="button" className="secondary-button" onClick={() => openFilePicker(document.id, document.project_id)} disabled={isUploading || !storageReady} title="Dodaj nową wersję">
                    <FilePlus2 size={14} aria-hidden="true" />Nowa wersja
                  </button>
                  <button type="button" className="secondary-button secondary-button--danger" onClick={() => void changeDocumentState(document.id, "trashed", document.project_id)} disabled={isUploading || isPending} title="Przenieś do kosza">
                    <Trash2 size={14} aria-hidden="true" />Do kosza
                  </button>
                </div>
              ) : null}

              {detailsOpen ? (
                <div className={styles.details}>
                  <div className={styles.detailBox}><span>Klasyfikacja</span><strong>{recognized}</strong></div>
                  <div className={styles.detailBox}><span>Miejsce docelowe</span><strong>{destination}</strong></div>
                  <div className={styles.detailBox}><span>Stan końcowy</span><strong>{outcome}</strong></div>
                  {flow?.rationale ? <p className={styles.rationale}><strong>Dlaczego AI:</strong> {flow.rationale}</p> : null}
                  <div className={styles.detailActions}>
                    {flow?.resultHref ? <a href={flow.resultHref}>Otwórz miejsce docelowe →</a> : null}
                    {flow?.stage === "review" && decisionHref && !flow.artifactId ? <a href={decisionHref}>Podejmij decyzję →</a> : null}
                    {flow?.artifactId ? <span className={styles.count}>Rekord docelowy: {flow.artifactType ?? "rekord"} · {flow.artifactId.slice(0, 8)}</span> : null}
                  </div>
                </div>
              ) : null}
            </article>
          );
        }) : (
          <div className={styles.empty}>
            <FileSearch size={22} aria-hidden="true" />
            <h3>Brak pasujących dokumentów</h3>
            <p>Wrzutnia przyjmie plik, Brain go rozpozna, pokaże cel i potwierdzi końcowy wynik routingu.</p>
          </div>
        )}
      </div>

      {trashedDocuments.length > 0 ? (
        <section className={styles.trash}>
          <div className={styles.trashHeader}><strong>Kosz</strong><p>{trashedDocuments.length} dokumentów · pliki w R2 pozostają zachowane</p></div>
          <div className={styles.list}>
            {trashedDocuments.map((document) => (
              <article key={document.id} className={styles.card}>
                <div className={styles.identity}><div className={styles.titleLine}><Trash2 size={16} aria-hidden="true" /><h3>{document.name}</h3></div><p className={styles.meta}>Przeniesiono do kosza</p></div>
                <div />
                <div className={styles.actions}>
                  <button type="button" className="secondary-button" onClick={() => void changeDocumentState(document.id, "active", document.project_id)} disabled={isPending}>
                    <RotateCcw size={14} aria-hidden="true" />Przywróć
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
