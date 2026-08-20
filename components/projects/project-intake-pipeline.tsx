"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Sparkles, UploadCloud, X } from "lucide-react";
import { DOCUMENT_DESTINATIONS, suggestDocumentClassification, type DocumentCategory } from "@/lib/documents/classification";
import { SUPPORTED_UPLOAD_ACCEPT, validateUploadFile } from "@/lib/r2/sanitize";

type Status = "ready" | "uploading" | "analysing" | "done" | "warning" | "error";
type Item = {
  id: string;
  file: File;
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

const MAX_HASH = 32 * 1024 * 1024;

function accepted(file: File) { return validateUploadFile(file.name, file.type || "application/octet-stream", file.size) === null; }
function size(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function icon(name: string) { return /\.(xlsx?|csv)$/i.test(name) ? FileSpreadsheet : FileText; }
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
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [position, setPosition] = useState<IntakePosition | null>(null);
  const [mounted, setMounted] = useState(false);
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

  function add(files: FileList | File[]) {
    const all = Array.from(files);
    const usable = all.filter(accepted);
    setNotice(usable.length !== all.length ? "Część plików pominięto. Obsługiwane są m.in. PDF, DOC/DOCX, XLS/XLSX, CSV, obrazy, ZIP, XML i pliki tekstowe do 50 MB." : null);
    setItems((current) => current.concat(usable.map((file) => {
      const suggestion = suggestDocumentClassification(file.name, file.type);
      return { id: crypto.randomUUID(), file, category: suggestion.category, locked: false, confidence: suggestion.confidence, reason: suggestion.reason, status: "ready" as const };
    })));
  }

  function setCategory(id: string, category: DocumentCategory) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, category, locked: true } : item));
  }

  async function processItem(item: Item) {
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: "uploading", error: undefined, message: "Wysyłanie do R2…" } : row));
    try {
      const mimeType = item.file.type || "application/octet-stream";
      const prepare = await fetch("/api/storage/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, fileName: item.file.name, mimeType, fileSize: item.file.size }) });
      if (!prepare.ok) throw new Error((await prepare.json().catch(() => null))?.error ?? "Nie udało się przygotować uploadu.");
      const upload = await prepare.json() as UploadResponse;
      const put = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: item.file });
      if (!put.ok) throw new Error(`R2 odrzucił upload: HTTP ${put.status}`);

      const complete = await fetch("/api/storage/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: upload.token, sha256: await digest(item.file), category: item.category }) });
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
      <input ref={input} className="pw-intake-file-input" type="file" accept={SUPPORTED_UPLOAD_ACCEPT} multiple onChange={(event) => event.target.files && add(event.target.files)} />
      <button type="button" className={`pw-intake-dropzone ${drag ? "is-dragging" : ""}`} onClick={() => input.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDrag(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDrag(false); }} onDrop={(event) => { event.preventDefault(); setDrag(false); add(event.dataTransfer.files); }}>
        <span className="pw-intake-cloud"><UploadCloud size={27} /></span><strong>Przeciągnij PDF, Word lub Excel</strong><small>DOC/DOCX i XLS/XLSX są odczytywane przez pipeline AI</small>
      </button>
      <div className="pw-intake-ai-note"><Sparkles size={16} /><span><strong>Pełna analiza AI:</strong> Gemini czyta zawartość, rozpoznaje fakty, materiały, urządzenia i pozycje kosztorysu. Ręczna zmiana kategorii blokuje jej automatyczne nadpisanie.</span></div>
      {notice ? <p className="pw-intake-error">{notice}</p> : null}
      {items.length ? <div className="pw-intake-list">{items.map((item) => { const Icon = icon(item.file.name); return <article className={`pw-intake-row is-${item.status}`} key={item.id}>
        <span className="pw-intake-file-icon"><Icon size={18} /></span><div className="pw-intake-file-main"><strong>{item.file.name}</strong><small>{size(item.file.size)} · {item.locked ? "kategoria ręczna" : `wstępna pewność: ${item.confidence}`}</small><p>{item.message ?? item.reason}</p></div>
        <label className="pw-intake-destination"><span>Przypisz do</span><select value={item.category} onChange={(event) => setCategory(item.id, event.target.value as DocumentCategory)} disabled={["uploading", "analysing", "done", "warning"].includes(item.status)}>{DOCUMENT_DESTINATIONS.map((destination) => <option key={destination.value} value={destination.value}>{destination.label}</option>)}</select></label>
        {item.status === "done" ? <span className="pw-intake-done"><CheckCircle2 size={17} /> Brain gotowy</span> : item.status === "warning" ? <span className="pw-intake-done"><AlertTriangle size={17} /> Plik zapisany</span> : <button type="button" className="pw-intake-remove" disabled={item.status === "uploading" || item.status === "analysing"} onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}>Usuń</button>}
        {item.error ? <p className="pw-intake-row-error">{item.error}</p> : null}
      </article>; })}</div> : null}
      <div className="pw-intake-actions"><span>{items.length ? `${items.length} plików w kolejce` : "Możesz dodać kilka plików jednocześnie"}</span><button type="button" onClick={run} disabled={busy || !ready}><Sparkles size={16} /> {busy ? "Octopus przetwarza…" : `Wyślij i analizuj${ready ? ` (${ready})` : ""}`}</button></div>
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
