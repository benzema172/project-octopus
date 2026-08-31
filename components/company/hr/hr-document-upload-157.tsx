"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, LoaderCircle, UploadCloud } from "lucide-react";
import { SUPPORTED_UPLOAD_ACCEPT, validateUploadFile } from "@/lib/r2/sanitize";
import styles from "./hr-document-upload-157.module.css";

type UploadResponse = { uploadUrl: string; token: string; headers: Record<string, string> };
type CompleteResponse = { documentId: string; versionId: string };
type BrainResponse = {
  ok?: boolean;
  hrIntake?: {
    matched?: boolean;
    employeeName?: string;
    documentType?: string;
    reason?: string;
    complianceRecords?: Array<{ kind?: string; detected?: boolean; created?: boolean; validUntil?: string | null; reason?: string }>;
    leaveRequest?: { detected?: boolean; created?: boolean; days?: number; reason?: string };
  } | null;
};

type Props = { workspaceId: string; canWrite: boolean; documentCount: number };

function complianceLabel(kind?: string) {
  return kind === "medical_exam" ? "badanie lekarskie" : kind === "safety_training" ? "BHP" : kind === "qualification" ? "uprawnienie" : "rekord formalny";
}

export function HrDocumentUpload157({ workspaceId, canWrite, documentCount }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadOne(file: File, index: number, total: number) {
    const mimeType = file.type || "application/octet-stream";
    const validationError = validateUploadFile(file.name, mimeType, file.size);
    if (validationError) throw new Error(`${file.name}: ${validationError}`);
    setStatus(`Plik ${index + 1} z ${total}: przygotowywanie ${file.name}`);
    const prepare = await fetch("/api/storage/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, projectId: null, documentId: null, fileName: file.name, mimeType, fileSize: file.size, category: "hr", categoryLocked: true }) });
    const prepared = await prepare.json().catch(() => ({})) as Partial<UploadResponse> & { error?: string };
    if (!prepare.ok || !prepared.uploadUrl || !prepared.token || !prepared.headers) throw new Error(prepared.error ?? `Nie udało się przygotować uploadu pliku ${file.name}.`);
    setStatus(`Plik ${index + 1} z ${total}: wysyłanie do bezpiecznego magazynu`);
    const put = await fetch(prepared.uploadUrl, { method: "PUT", headers: prepared.headers, body: file });
    if (!put.ok) throw new Error(`${file.name}: magazyn plików odrzucił wysyłkę (HTTP ${put.status}).`);
    setStatus(`Plik ${index + 1} z ${total}: OCR, analiza, terminy i przypisanie do pracownika`);
    const complete = await fetch("/api/storage/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: prepared.token }) });
    const completed = await complete.json().catch(() => ({})) as Partial<CompleteResponse> & { error?: string };
    if (!complete.ok || !completed.documentId || !completed.versionId) throw new Error(completed.error ?? `${file.name}: nie udało się zapisać dokumentu.`);
    const analysis = await fetch("/api/brain/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, versionId: completed.versionId }) }).catch(() => null);
    if (!analysis?.ok) return { saved: true, analysisStarted: false, fileName: file.name, assignment: "" };
    const result = await analysis.json().catch(() => ({})) as BrainResponse;
    const intake = result.hrIntake;
    let assignment = "";
    if (intake?.matched && intake.employeeName) {
      assignment = `${intake.documentType ?? "Dokument HR"} → ${intake.employeeName}`;
      for (const record of intake.complianceRecords ?? []) {
        if (record.created) assignment += ` · utworzono ${complianceLabel(record.kind)}${record.validUntil ? ` (ważne do ${record.validUntil})` : ""}`;
        else if (record.detected && record.reason) assignment += ` · ${complianceLabel(record.kind)}: ${record.reason}`;
      }
      if (intake.leaveRequest?.created) assignment += ` · utworzono wniosek urlopowy (${intake.leaveRequest.days ?? 0} dni)`;
      else if (intake.leaveRequest?.detected && intake.leaveRequest.reason) assignment += ` · ${intake.leaveRequest.reason}`;
    } else if (intake?.reason) assignment = `wymaga decyzji: ${intake.reason}`;
    return { saved: true, analysisStarted: true, fileName: file.name, assignment };
  }

  async function uploadFiles(files: File[]) {
    if (!canWrite || uploading || !files.length) return;
    setUploading(true); setError(null); setStatus(null);
    let done = 0; let analysisStarted = 0;
    const failures: string[] = []; const analysisWarnings: string[] = []; const assignments: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        try {
          const result = await uploadOne(file, index, files.length); done += 1;
          if (result.analysisStarted) analysisStarted += 1; else analysisWarnings.push(`${result.fileName}: plik zapisano, ale analiza Octopus Brain nie została uruchomiona.`);
          if (result.assignment) assignments.push(`${result.fileName}: ${result.assignment}`);
        } catch (reason) { failures.push(reason instanceof Error ? reason.message : `${file.name}: upload nie powiódł się.`); }
      }
      if (done) {
        const base = analysisStarted === done ? `Gotowe: zapisano i przeanalizowano ${done} z ${files.length} plików HR.` : `Zapisano ${done} z ${files.length} plików HR. Analiza AI zakończyła się dla ${analysisStarted} z ${done}.`;
        setStatus(assignments.length ? `${base} ${assignments.join(" · ")}` : base);
      }
      const problems = [...failures, ...analysisWarnings]; if (problems.length) setError(problems.join(" · "));
      router.refresh();
    } finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  return <div className={styles.wrap} data-hr-functional-upload="1" data-hr-document-count={documentCount}>
    <p className={styles.intro}>Wrzuć dokumenty kadrowe. OCR i Octopus Brain rozpoznają pracownika, typ dokumentu i terminy; przy wysokiej pewności zasilą automatycznie badania, BHP, uprawnienia lub wnioski urlopowe.</p>
    <button type="button" className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`} disabled={!canWrite || uploading} onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); if (canWrite && !uploading) setDragging(true); }} onDragOver={(event) => { event.preventDefault(); if (canWrite && !uploading) setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadFiles(Array.from(event.dataTransfer.files ?? [])); }}>
      <span className={styles.icon}>{uploading ? <LoaderCircle size={24} className={styles.spin} /> : <UploadCloud size={24} />}</span><span className={styles.copy}><strong>{uploading ? "Wysyłanie i rozpoznawanie dokumentów…" : "Przeciągnij pliki tutaj lub kliknij, aby wybrać"}</strong><small>PDF, zdjęcia, Word, Excel i inne obsługiwane dokumenty · maks. 50 MB na plik</small></span><span className={styles.pick}><FileUp size={16} /> Wybierz pliki</span>
    </button>
    <input ref={inputRef} className={styles.input} type="file" accept={SUPPORTED_UPLOAD_ACCEPT} multiple disabled={!canWrite || uploading} onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))} />
    {!canWrite ? <div className={styles.notice}>Masz dostęp tylko do odczytu. Uprawnienie do zapisu w Kadrach jest wymagane do wysyłania dokumentów.</div> : null}
    {status ? <div className={styles.status} role="status"><CheckCircle2 size={15} /><span>{status}</span></div> : null}{error ? <div className={styles.error} role="alert"><span>{error}</span></div> : null}
    <a className={styles.libraryLink} href={`/workspace/companies/${workspaceId}/documents?upload=1`}>Otwórz pełną bibliotekę dokumentów →</a>
  </div>;
}
