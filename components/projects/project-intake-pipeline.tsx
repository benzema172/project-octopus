"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, FolderOpen, Sparkles, UploadCloud, X } from "lucide-react";
import { DOCUMENT_DESTINATIONS, suggestDocumentClassification, type DocumentCategory } from "@/lib/documents/classification";
import { SUPPORTED_UPLOAD_ACCEPT, validateUploadFile } from "@/lib/r2/sanitize";

type Status = "ready" | "uploading" | "analysing" | "done" | "warning" | "error";
type Item = {
  id: string;
  file: File;
  relativePath: string;
  category: DocumentCategory;
  locked: boolean;
  confidence: string;
  reason: string;
  status: Status;
  message?: string;
  error?: string;
};
type UploadResponse = { uploadUrl: string; token: string; headers: Record<string, string> };
type CompleteResponse = { documentId: string; versionId: string };
type ProcessResponse = { category?: DocumentCategory; confidence?: number; counts?: Record<string, number>; error?: string };
type IntakePosition = { top: number; right: number; width: number; maxHeight: number };
type ReleaseType = "baseline" | "revision" | "addendum" | "as_built" | "closeout" | "other";
type UploadCandidate = { file: File; relativePath: string };
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

function accepted(file: File) { return validateUploadFile(file.name, file.type || "application/octet-stream", file.size) === null; }
function size(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function icon(name: string) { return /\.(xlsx?|csv)$/i.test(name) ? FileSpreadsheet : FileText; }
function normalizeRelativePath(value: string) { return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/"); }
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
function packageLabelForItem(baseLabel: string, item: Item) {
  const folderPath = folderPathForCandidate({ file: item.file, relativePath: item.relativePath });
  const parts = [baseLabel.trim(), folderPath].filter(Boolean);
  return parts.length ? parts.join(" / ").slice(0, 160) : undefined;
}
async function digest(file: File) {
  if (file.size > MAX_HASH) return null;
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [position, setPosition] = useState<IntakePosition | null>(null);
  const [mounted, setMounted] = useState(false);
  const [releaseType, setReleaseType] = useState<ReleaseType>("baseline");
  const [packageLabel, setPackageLabel] = useState("");
  const [revisionLabel, setRevisionLabel] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

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

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || popover.current?.contains(target)) return;
      setOpen(false);
    };

    updatePosition();
    folderInput.current?.setAttribute("webkitdirectory", "");
    folderInput.current?.setAttribute("directory", "");
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

  function add(candidates: UploadCandidate[]) {
    const withoutArtifacts = candidates.filter((candidate) => !shouldIgnoreFolderArtifact(candidate));
    const limited = withoutArtifacts.slice(0, MAX_FOLDER_FILES);
    const usable = limited.filter((candidate) => accepted(candidate.file));
    const notices: string[] = [];
    if (withoutArtifacts.length > MAX_FOLDER_FILES) notices.push(`Folder ma ponad ${MAX_FOLDER_FILES} plików — przyjęto pierwsze ${MAX_FOLDER_FILES}.`);
    if (usable.length !== limited.length) notices.push("Część plików pominięto. Obsługiwane są PDF, DOC/DOCX, XLS/XLSX, CSV, obrazy, XML, pliki tekstowe i bezpieczne paczki ZIP do 50 MB.");
    setNotice(notices.length ? notices.join(" ") : null);
    setItems((current) => {
      const known = new Set(current.map((item) => `${item.relativePath}:${item.file.size}:${item.file.lastModified}`));
      const next: Item[] = [];
      for (const candidate of usable) {
        const key = `${candidate.relativePath}:${candidate.file.size}:${candidate.file.lastModified}`;
        if (known.has(key)) continue;
        known.add(key);
        const suggestion = suggestDocumentClassification(candidate.file.name, candidate.file.type);
        next.push({
          id: crypto.randomUUID(),
          file: candidate.file,
          relativePath: candidate.relativePath,
          category: suggestion.category,
          locked: false,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          status: "ready"
        });
      }
      return current.concat(next);
    });
  }

  async function addDropped(dataTransfer: DataTransfer) {
    try {
      const candidates = await candidatesFromDataTransfer(dataTransfer);
      add(candidates);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się odczytać folderu.");
    }
  }

  function setCategory(id: string, category: DocumentCategory) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, category, locked: true } : item));
  }

  async function processItem(item: Item) {
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "uploading", error: undefined, message: "Wysyłanie do R2…" } : row));
    try {
      const mimeType = item.file.type || "application/octet-stream";
      const prepare = await fetch("/api/storage/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          fileName: item.file.name,
          mimeType,
          fileSize: item.file.size,
          category: item.category,
          categoryLocked: item.locked,
          releaseType,
          packageLabel: packageLabelForItem(packageLabel, item),
          revisionLabel: revisionLabel || undefined,
          effectiveAt: effectiveAt || undefined
        })
      });
      if (!prepare.ok) throw new Error((await prepare.json().catch(() => null))?.error ?? "Nie udało się przygotować uploadu.");
      const upload = await prepare.json() as UploadResponse;
      const put = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: item.file });
      if (!put.ok) throw new Error(`R2 odrzucił upload: HTTP ${put.status}`);

      const complete = await fetch("/api/storage/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: upload.token, sha256: await digest(item.file) }) });
      if (!complete.ok) throw new Error((await complete.json().catch(() => null))?.error ?? "Nie udało się zapisać dokumentu.");
      const ids = await complete.json() as CompleteResponse;

      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "analysing", message: "Gemini analizuje treść i buduje Brain…" } : row));
      const analysis = await fetch("/api/brain/process-document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, documentId: ids.documentId, versionId: ids.versionId, lockCategory: item.locked }) });
      const result = await analysis.json().catch(() => null) as ProcessResponse | null;
      if (!analysis.ok) {
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "warning", message: "Plik zapisany. Analiza AI wymaga ponowienia.", error: result?.error ?? "Analiza AI nie powiodła się." } : row));
        return true;
      }

      const count = Object.values(result?.counts ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "done", category: result?.category ?? row.category, message: `Brain gotowy · ${Math.round((result?.confidence ?? 0) * 100)}% pewności · ${count} rozpoznanych elementów` } : row));
      return true;
    } catch (error) {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "error", error: error instanceof Error ? error.message : "Przetwarzanie nie powiodło się." } : row));
      return false;
    }
  }

  async function run() {
    let changed = false;
    for (const item of items.filter((row) => row.status === "ready" || row.status === "error")) changed = (await processItem(item)) || changed;
    if (changed) startTransition(() => router.refresh());
  }

  const busy = pending || items.some((item) => item.status === "uploading" || item.status === "analysing");
  const ready = items.filter((item) => item.status === "ready" || item.status === "error").length;

  const dialog = open && position ? (
    <div
      ref={popover}
      className="pw-intake-popover pw-intake-popover--portal"
      role="dialog"
      aria-modal="false"
      aria-label="Wrzutnia dokumentów"
      id="project-intake-dialog"
      style={position}
    >
      <div className="pw-intake-head"><div><p className="co-kicker">Centralne wejście plików</p><h3>Wrzutnia</h3><p>R2 → ekstrakcja → Gemini → klasyfikacja → Brain → moduły.</p></div><button type="button" className="pw-intake-close" onClick={() => setOpen(false)} aria-label="Zamknij Wrzutnię"><X size={17} /></button></div>
      <div className="pw-intake-release" aria-label="Metadane wydania dokumentacji">
        <label><span>Typ wydania</span><select value={releaseType} onChange={(event) => setReleaseType(event.target.value as ReleaseType)} disabled={busy}><option value="baseline">Bazowe</option><option value="revision">Rewizja</option><option value="addendum">Aneks / uzupełnienie</option><option value="as_built">Powykonawcze</option><option value="closeout">Zamknięcie</option><option value="other">Inne</option></select></label>
        <label><span>Nazwa paczki</span><input value={packageLabel} onChange={(event) => setPackageLabel(event.target.value)} placeholder="np. PW Instalacje sanitarne" maxLength={160} disabled={busy}/></label>
        <label><span>Oznaczenie rewizji</span><input value={revisionLabel} onChange={(event) => setRevisionLabel(event.target.value)} placeholder="np. R02" maxLength={80} disabled={busy}/></label>
        <label><span>Obowiązuje od</span><input type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} disabled={busy}/></label>
      </div>
      <input ref={input} className="pw-intake-file-input" type="file" accept={SUPPORTED_UPLOAD_ACCEPT} multiple onChange={(event) => { if (event.target.files) add(Array.from(event.target.files).map(candidateFromFile)); event.currentTarget.value = ""; }} />
      <input ref={(node) => { folderInput.current = node; node?.setAttribute("webkitdirectory", ""); node?.setAttribute("directory", ""); }} className="pw-intake-file-input" type="file" multiple aria-label="Wybierz folder z dokumentacją" onChange={(event) => { if (event.target.files) add(Array.from(event.target.files).map(candidateFromFile)); event.currentTarget.value = ""; }} />
      <div className={`pw-intake-dropzone ${drag ? "is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDrag(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDrag(false); }} onDrop={(event) => { event.preventDefault(); setDrag(false); void addDropped(event.dataTransfer); }}>
        <span className="pw-intake-cloud"><UploadCloud size={27} /></span><strong>Przeciągnij pliki lub cały folder</strong><small>Foldery i podfoldery zachowują swoją ścieżkę · maks. {MAX_FOLDER_FILES} plików na wybór</small>
        <div className="pw-intake-actions pw-intake-picker-actions">
          <button type="button" onClick={() => input.current?.click()} disabled={busy}>Wybierz pliki</button>
          <button type="button" onClick={() => folderInput.current?.click()} disabled={busy}><FolderOpen size={15} /> Wybierz folder</button>
        </div>
      </div>
      <div className="pw-intake-ai-note"><Sparkles size={16} /><span><strong>Analiza z kontrolą człowieka:</strong> Gemini odczyta fakty, BOQ, harmonogram, WM, protokoły, przeroby i ryzyka. Nic formalnego ani finansowego nie trafi do modułów bez decyzji w Centrum weryfikacji.</span></div>
      {notice ? <p className="pw-intake-error">{notice}</p> : null}
      {items.length ? <div className="pw-intake-list">{items.map((item) => { const Icon = icon(item.file.name); const folderPath = folderPathForCandidate({ file: item.file, relativePath: item.relativePath }); return <article className={`pw-intake-row is-${item.status}`} key={item.id}>
        <span className="pw-intake-file-icon"><Icon size={18} /></span><div className="pw-intake-file-main"><strong>{item.file.name}</strong><small>{size(item.file.size)} · {item.locked ? "kategoria ręczna" : `wstępna pewność: ${item.confidence}`}{folderPath ? ` · ${folderPath}` : ""}</small><p>{item.message ?? item.reason}</p></div>
        <label className="pw-intake-destination"><span>Przypisz do</span><select value={item.category} onChange={(event) => setCategory(item.id, event.target.value as DocumentCategory)} disabled={["uploading", "analysing", "done", "warning"].includes(item.status)}>{DOCUMENT_DESTINATIONS.map((destination) => <option key={destination.value} value={destination.value}>{destination.label}</option>)}</select></label>
        {item.status === "done" ? <span className="pw-intake-done"><CheckCircle2 size={17} /> Brain gotowy</span> : item.status === "warning" ? <span className="pw-intake-done"><AlertTriangle size={17} /> Plik zapisany</span> : <button type="button" className="pw-intake-remove" disabled={item.status === "uploading" || item.status === "analysing"} onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}>Usuń</button>}
        {item.error ? <p className="pw-intake-row-error">{item.error}</p> : null}
      </article>; })}</div> : null}
      <div className="pw-intake-actions"><span>{items.length ? `${items.length} plików w kolejce` : "Możesz dodać pliki albo cały folder"}</span><button type="button" onClick={run} disabled={busy || !ready}><Sparkles size={16} /> {busy ? "Octopus przetwarza…" : `Wyślij i analizuj${ready ? ` (${ready})` : ""}`}</button></div>
    </div>
  ) : null;

  return <div className="pw-intake">
    <button
      ref={trigger}
      type="button"
      className="pw-intake-trigger pw-intake-trigger--octopus"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      aria-controls="project-intake-dialog"
      aria-haspopup="dialog"
    >
      <IntakeOctopus />
      <span className="pw-intake-trigger__label">WRZUTNIA</span>
    </button>
    {mounted && dialog ? createPortal(dialog, document.body) : null}
  </div>;
}
