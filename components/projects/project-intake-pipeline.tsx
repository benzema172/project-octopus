"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileUp, FolderOpen, Sparkles, UploadCloud, X } from "lucide-react";
import { validateUploadFile } from "@/lib/r2/sanitize";

type Status = "ready" | "uploading" | "analysing" | "done" | "warning" | "error";
type Item = {
  id: string;
  file: File;
  relativePath: string;
  status: Status;
  message?: string;
  error?: string;
};
type UploadResponse = { uploadUrl: string; token: string; headers: Record<string, string> };
type CompleteResponse = { documentId: string; versionId: string };
type ProcessResponse = {
  category?: string;
  confidence?: number;
  counts?: Record<string, number>;
  routing?: { normalizedName?: string; discipline?: string; systemName?: string | null };
  error?: string;
};
type IntakePosition = { top: number; right: number; width: number; maxHeight: number };
type UploadCandidate = { file: File; relativePath: string };
type IntakeIssue = { id: string; name: string; relativePath: string; bytes: number; reason: string };
type UploadProgress = { totalFiles: number; uploadedFiles: number; totalBytes: number; uploadedBytes: number; settledFiles: number };
type BrowserFileEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
  file?: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: BrowserFileEntry[]) => void, failure?: (error: DOMException) => void) => void;
  };
};

const MAX_HASH = 32 * 1024 * 1024;
const MAX_FOLDER_FILES = 1000;
const IGNORED_FOLDER_ARTIFACTS = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const EMPTY_PROGRESS: UploadProgress = { totalFiles: 0, uploadedFiles: 0, totalBytes: 0, uploadedBytes: 0, settledFiles: 0 };

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(0.01, bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

function artifactReason(candidate: UploadCandidate) {
  const parts = normalizeRelativePath(candidate.relativePath).split("/").filter(Boolean);
  if (IGNORED_FOLDER_ARTIFACTS.has(candidate.file.name)) return "Plik systemowy systemu operacyjnego — pominięty.";
  if (parts.includes("__MACOSX")) return "Techniczny plik pomocniczy macOS — pominięty.";
  return null;
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
  const nested = await Promise.all(children.map((child) => candidatesFromEntry(child, entryPath)));
  return nested.flat();
}

async function candidatesFromDataTransfer(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items ?? []);
  const roots: BrowserFileEntry[] = [];
  for (const item of items) {
    const entryGetter = (item as unknown as { webkitGetAsEntry?: () => BrowserFileEntry | null }).webkitGetAsEntry;
    const entry = entryGetter?.call(item);
    if (entry) roots.push(entry);
  }
  if (!roots.length) return Array.from(dataTransfer.files ?? []).map(candidateFromFile);
  const nested = await Promise.all(roots.map((entry) => candidatesFromEntry(entry)));
  return nested.flat();
}

async function digest(file: File) {
  if (file.size > MAX_HASH) return null;
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uploadFileWithProgress(upload: UploadResponse, file: File, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", upload.uploadUrl);
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => onProgress(Math.min(event.loaded, file.size));
    xhr.onerror = () => reject(new Error("Nie udało się połączyć z magazynem R2."));
    xhr.onabort = () => reject(new Error("Wysyłanie pliku zostało przerwane."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size);
        resolve();
      } else reject(new Error(`R2 odrzucił upload: HTTP ${xhr.status}`));
    };
    xhr.send(file);
  });
}

function IntakeOctopus() {
  return (
    <span className="pw-intake-octopus" aria-hidden="true">
      <svg viewBox="0 0 112 64" focusable="false">
        <defs>
          <linearGradient id="pw-intake-octo-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ff2d86" />
            <stop offset="34%" stopColor="#8a2be2" />
            <stop offset="68%" stopColor="#315be9" />
            <stop offset="100%" stopColor="#00cfc2" />
          </linearGradient>
        </defs>
        <g className="pw-octo-tentacle pw-octo-tentacle--1"><path d="M43 34C34 35 31 42 24 46C18 49 13 47 11 42" /></g>
        <g className="pw-octo-tentacle pw-octo-tentacle--2"><path d="M46 36C39 40 37 49 31 53C27 56 23 55 20 52" /></g>
        <g className="pw-octo-tentacle pw-octo-tentacle--3"><path d="M50 37C45 44 45 52 40 58C37 61 33 60 31 57" /></g>
        <g className="pw-octo-tentacle pw-octo-tentacle--4"><path d="M54 37C52 46 53 54 49 60" /></g>
        <g className="pw-octo-tentacle pw-octo-tentacle--5"><path d="M58 37C60 46 59 54 63 60" /></g>
        <g className="pw-octo-tentacle pw-octo-tentacle--6"><path d="M62 37C67 44 67 52 72 58C75 61 79 60 81 57" /></g>
        <g className="pw-octo-tentacle pw-octo-tentacle--7"><path d="M66 36C73 40 75 49 81 53C85 56 89 55 92 52" /></g>
        <g className="pw-octo-tentacle pw-octo-tentacle--8"><path d="M69 34C78 35 81 42 88 46C94 49 99 47 101 42" /></g>
        <path className="pw-octo-head" d="M39 24C39 11 45 5 56 5s17 6 17 19c0 7-3 12-8 15H47c-5-3-8-8-8-15Z" />
        <circle className="pw-octo-eye" cx="50" cy="22" r="3.1" />
        <circle className="pw-octo-eye" cx="62" cy="22" r="3.1" />
        <circle className="pw-octo-pupil" cx="50.5" cy="22.4" r="1.25" />
        <circle className="pw-octo-pupil" cx="62.5" cy="22.4" r="1.25" />
        <path className="pw-octo-smile" d="M51 29c3 2.4 7 2.4 10 0" />
      </svg>
    </span>
  );
}

export function ProjectIntake({ projectId }: { projectId: string }) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const knownFiles = useRef(new Set<string>());
  const queue = useRef<Item[]>([]);
  const processingQueue = useRef(false);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [issues, setIssues] = useState<IntakeIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress>(EMPTY_PROGRESS);
  const [stage, setStage] = useState("Dodaj pliki lub folder. Resztę zrobi Octopus AI.");
  const [processing, setProcessing] = useState(false);
  const [position, setPosition] = useState<IntakePosition | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const triggerRect = trigger.current?.getBoundingClientRect();
      if (!triggerRect) return;
      const navigation = document.querySelector<HTMLElement>(".project-navigation--v5");
      const navigationBottom = navigation?.getBoundingClientRect().bottom ?? triggerRect.bottom;
      const viewportPadding = window.innerWidth <= 680 ? 12 : 16;
      const width = Math.min(760, Math.max(280, window.innerWidth - viewportPadding * 2));
      const maxRight = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      const desiredRight = Math.max(viewportPadding, window.innerWidth - triggerRect.right);
      const right = Math.min(desiredRight, maxRight);
      const desiredTop = Math.max(viewportPadding, navigationBottom + 12);
      const top = Math.min(desiredTop, Math.max(viewportPadding, window.innerHeight - 260));
      const maxHeight = Math.max(220, window.innerHeight - top - viewportPadding);
      setPosition({ top, right, width, maxHeight });
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || popover.current?.contains(target)) return;
      setOpen(false);
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutside);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [open]);

  function addIssue(candidate: UploadCandidate, reason: string) {
    const key = `${candidate.relativePath}:${candidate.file.size}:${reason}`;
    setIssues((current) => current.some((issue) => `${issue.relativePath}:${issue.bytes}:${issue.reason}` === key)
      ? current
      : current.concat({ id: crypto.randomUUID(), name: candidate.file.name, relativePath: candidate.relativePath, bytes: candidate.file.size, reason }));
  }

  async function processItem(item: Item) {
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "uploading", error: undefined, message: "Wysyłanie…" } : row));
    let reportedBytes = 0;
    try {
      const mimeType = item.file.type || "application/octet-stream";
      setStage(`Wysyłanie: ${item.file.name}`);
      const prepare = await fetch("/api/storage/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          fileName: item.file.name,
          mimeType,
          fileSize: item.file.size,
          categoryLocked: false,
          packageLabel: folderPathForCandidate({ file: item.file, relativePath: item.relativePath })
        })
      });
      if (!prepare.ok) throw new Error((await prepare.json().catch(() => null))?.error ?? "Nie udało się przygotować uploadu.");
      const upload = await prepare.json() as UploadResponse;
      await uploadFileWithProgress(upload, item.file, (loaded) => {
        const next = Math.max(reportedBytes, Math.min(loaded, item.file.size));
        const delta = next - reportedBytes;
        if (delta <= 0) return;
        reportedBytes = next;
        setProgress((current) => ({ ...current, uploadedBytes: Math.min(current.totalBytes, current.uploadedBytes + delta) }));
      });
      setProgress((current) => ({ ...current, uploadedFiles: current.uploadedFiles + 1 }));

      const complete = await fetch("/api/storage/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: upload.token, sha256: await digest(item.file) })
      });
      if (!complete.ok) throw new Error((await complete.json().catch(() => null))?.error ?? "Plik wysłano do R2, ale nie udało się zapisać dokumentu.");
      const ids = await complete.json() as CompleteResponse;

      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "analysing", message: "AI analizuje, nazywa i przypisuje…" } : row));
      setStage(`Octopus AI porządkuje: ${item.file.name}`);
      const analysis = await fetch("/api/brain/process-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, documentId: ids.documentId, versionId: ids.versionId, lockCategory: false })
      });
      const result = await analysis.json().catch(() => null) as ProcessResponse | null;
      if (!analysis.ok) {
        const reason = result?.error ?? "Analiza AI nie powiodła się.";
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "warning", message: "Plik zapisany. Analiza AI wymaga ponowienia.", error: reason } : row));
        addIssue({ file: item.file, relativePath: item.relativePath }, `Plik przesłano, ale analiza AI wymaga uwagi: ${reason}`);
        return true;
      }

      const count = Object.values(result?.counts ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
      const normalizedName = result?.routing?.normalizedName || item.file.name;
      setItems((current) => current.map((row) => row.id === item.id ? {
        ...row,
        status: "done",
        message: `${normalizedName} · ${Math.round((result?.confidence ?? 0) * 100)}% · ${count} elementów`
      } : row));
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Przetwarzanie nie powiodło się.";
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "error", error: reason } : row));
      addIssue({ file: item.file, relativePath: item.relativePath }, reason);
      return false;
    } finally {
      setProgress((current) => ({ ...current, settledFiles: current.settledFiles + 1 }));
    }
  }

  async function drainQueue() {
    if (processingQueue.current) return;
    processingQueue.current = true;
    setProcessing(true);
    let changed = false;
    try {
      while (queue.current.length) {
        const item = queue.current.shift();
        if (!item) continue;
        changed = (await processItem(item)) || changed;
      }
    } finally {
      processingQueue.current = false;
      setProcessing(false);
      setStage("Gotowe. Możesz wrzucić kolejne pliki.");
      if (changed) startTransition(() => router.refresh());
      if (queue.current.length) void drainQueue();
    }
  }

  function add(candidates: UploadCandidate[]) {
    setNotice(null);
    const accepted: Item[] = [];
    let eligibleCount = 0;
    for (const candidate of candidates) {
      const systemReason = artifactReason(candidate);
      if (systemReason) { addIssue(candidate, systemReason); continue; }
      eligibleCount += 1;
      if (eligibleCount > MAX_FOLDER_FILES) { addIssue(candidate, `Przekroczono limit ${MAX_FOLDER_FILES} plików w jednym wskazaniu.`); continue; }
      const validationError = validateUploadFile(candidate.file.name, candidate.file.type || "application/octet-stream", candidate.file.size);
      if (validationError) { addIssue(candidate, validationError); continue; }
      const key = `${candidate.relativePath}:${candidate.file.size}:${candidate.file.lastModified}`;
      if (knownFiles.current.has(key)) { addIssue(candidate, "Duplikat — ten sam plik jest już w bieżącej kolejce."); continue; }
      knownFiles.current.add(key);
      accepted.push({ id: crypto.randomUUID(), file: candidate.file, relativePath: candidate.relativePath, status: "ready" });
    }
    if (!accepted.length) return;
    const addedBytes = accepted.reduce((sum, item) => sum + item.file.size, 0);
    setItems((current) => current.concat(accepted));
    setProgress((current) => ({ ...current, totalFiles: current.totalFiles + accepted.length, totalBytes: current.totalBytes + addedBytes }));
    queue.current.push(...accepted);
    setStage(`Dodano ${accepted.length} plików. Octopus zaczyna automatyczne przetwarzanie…`);
    void drainQueue();
  }

  async function addDropped(dataTransfer: DataTransfer) {
    try {
      add(await candidatesFromDataTransfer(dataTransfer));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się odczytać przeciągniętych danych.");
    }
  }

  const busy = processing || pending;
  const percent = progress.totalBytes > 0 ? Math.min(100, Math.round((progress.uploadedBytes / progress.totalBytes) * 100)) : 0;
  const completedAi = items.filter((item) => item.status === "done" || item.status === "warning").length;

  const dialog = open && position ? (
    <div ref={popover} className="pw-intake-popover pw-intake-popover--portal" role="dialog" aria-modal="false" aria-label="Wrzutnia dokumentów" id="project-intake-dialog" style={position}>
      <input ref={fileInput} type="file" multiple hidden onChange={(event) => { add(Array.from(event.target.files ?? []).map(candidateFromFile)); event.currentTarget.value = ""; }} />
      <input
        ref={(node) => {
          folderInput.current = node;
          node?.setAttribute("webkitdirectory", "");
          node?.setAttribute("directory", "");
        }}
        type="file"
        multiple
        hidden
        onChange={(event) => { add(Array.from(event.target.files ?? []).map(candidateFromFile)); event.currentTarget.value = ""; }}
      />
      <div className="pw-intake-head">
        <div><p className="co-kicker">Tylko wrzucasz pliki</p><h3>Wrzutnia</h3><p>Octopus AI sam rozpozna, nazwie, posortuje i zasili właściwe moduły inwestycji.</p></div>
        <button type="button" className="pw-intake-close" onClick={() => setOpen(false)} aria-label="Zamknij Wrzutnię"><X size={17} /></button>
      </div>

      <div
        className={`pw-intake-dropzone ${drag ? "is-dragging" : ""}`}
        aria-label="Przeciągnij tutaj pliki, ZIP lub folder z dokumentacją"
        onDragEnter={(event) => { event.preventDefault(); setDrag(true); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
        onDragLeave={(event) => { event.preventDefault(); setDrag(false); }}
        onDrop={(event) => { event.preventDefault(); setDrag(false); void addDropped(event.dataTransfer); }}
      >
        <span className="pw-intake-cloud"><UploadCloud size={27} /></span>
        <strong>Upuść dokumenty albo cały folder</strong>
        <small>Bez wybierania kategorii, branży, rewizji ani miejsca docelowego. AI zrobi to automatycznie na podstawie treści i kontekstu inwestycji.</small>
      </div>

      <div className="pw-intake-actions">
        <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()} disabled={busy}><FileUp size={16} />Wybierz pliki</button>
        <button type="button" className="secondary-button" onClick={() => folderInput.current?.click()} disabled={busy}><FolderOpen size={16} />Wybierz folder</button>
      </div>

      <div className="pw-intake-ai-note"><Sparkles size={16} /><span><strong>Po wrzuceniu:</strong> R2 → ekstrakcja → Gemini → klasyfikacja → automatyczna nazwa i system/branża → Brain → kosztorys, materiały, harmonogram, zadania, finanse, magazyn i wymagane szkice protokołów. Wyników rzeczywistych prób, podpisów i odbiorów AI nie wymyśla.</span></div>
      {notice ? <p className="pw-intake-error">{notice}</p> : null}

      {progress.totalFiles > 0 ? <section className="pw-intake-progress" aria-live="polite" aria-label="Postęp wysyłania dokumentacji">
        <div className="pw-intake-progress__head"><strong>{percent}% przesłano</strong><span>{stage}</span></div>
        <div className="pw-intake-progress__track"><span style={{ width: `${percent}%` }} /></div>
        <div className="pw-intake-progress__stats">
          <span><strong>{progress.uploadedFiles}/{progress.totalFiles}</strong> plików w R2</span>
          <span><strong>{formatBytes(progress.uploadedBytes)}</strong> / {formatBytes(progress.totalBytes)}</span>
          <span><strong>{completedAi}/{progress.totalFiles}</strong> przeanalizowanych przez AI</span>
        </div>
      </section> : null}

      {issues.length ? <details className="pw-intake-skipped" open>
        <summary><AlertTriangle size={15} /> Pominięte / wymagające uwagi <strong>{issues.length}</strong></summary>
        <div className="pw-intake-skipped__list">
          {issues.map((issue) => <article key={issue.id}>
            <div><strong>{issue.name}</strong><small>{issue.relativePath !== issue.name ? issue.relativePath : "Plik główny"} · {formatBytes(issue.bytes)}</small></div>
            <p>{issue.reason}</p>
          </article>)}
        </div>
      </details> : null}

      <div className="pw-intake-auto-status"><span>{busy ? "Octopus pracuje automatycznie — niczego nie musisz przypisywać ręcznie." : "Wrzutnia służy wyłącznie do dodawania plików. Posortowane dokumenty znajdziesz w sekcji Dokumenty."}</span></div>
    </div>
  ) : null;

  return <div className="pw-intake">
    <button ref={trigger} type="button" className="pw-intake-trigger pw-intake-trigger--octopus" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="project-intake-dialog" aria-haspopup="dialog">
      <IntakeOctopus />
      <span className="pw-intake-trigger__label">WRZUTNIA</span>
    </button>
    {dialog ? createPortal(dialog, document.body) : null}
  </div>;
}
