"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Sparkles, UploadCloud, X } from "lucide-react";
import { DOCUMENT_DESTINATIONS, suggestDocumentClassification, type DocumentCategory } from "@/lib/documents/classification";

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

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv";
const MAX_HASH = 32 * 1024 * 1024;

function accepted(file: File) { return /\.(pdf|docx?|xlsx?|csv)$/i.test(file.name); }
function size(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function icon(name: string) { return /\.(xlsx?|csv)$/i.test(name) ? FileSpreadsheet : FileText; }
async function digest(file: File) {
  if (file.size > MAX_HASH) return null;
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ProjectIntake({ projectId }: { projectId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(files: FileList | File[]) {
    const all = Array.from(files);
    const usable = all.filter(accepted);
    setNotice(usable.length !== all.length ? "Obsługiwane są PDF, DOC/DOCX, XLS/XLSX i CSV. Nieobsługiwane pliki pominięto." : null);
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

  return <div className="pw-intake">
    <button type="button" className="pw-intake-trigger" onClick={() => setOpen((value) => !value)}><UploadCloud size={16} /> WRZUTNIA</button>
    {open ? <div className="pw-intake-popover" role="dialog" aria-label="Wrzutnia dokumentów">
      <div className="pw-intake-head"><div><p className="co-kicker">Centralne wejście plików</p><h3>Wrzutnia</h3><p>R2 → ekstrakcja → Gemini → klasyfikacja → Brain → moduły.</p></div><button type="button" className="pw-intake-close" onClick={() => setOpen(false)}><X size={17} /></button></div>
      <input ref={input} className="pw-intake-file-input" type="file" accept={ACCEPT} multiple onChange={(event) => event.target.files && add(event.target.files)} />
      <button type="button" className={`pw-intake-dropzone ${drag ? "is-dragging" : ""}`} onClick={() => input.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDrag(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDrag(false); }} onDrop={(event) => { event.preventDefault(); setDrag(false); add(event.dataTransfer.files); }}>
        <span className="pw-intake-cloud"><UploadCloud size={27} /></span><strong>Przeciągnij PDF, Word lub Excel</strong><small>albo kliknij, aby wybrać pliki z dysku</small>
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
    </div> : null}
  </div>;
}
