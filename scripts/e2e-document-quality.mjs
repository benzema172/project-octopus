/** Live integration fixtures run only in the existing dedicated guest audit workspace. */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";
const base = process.env.E2E_BASE_URL;
if (!base || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) throw Error("Missing public live-test configuration");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function api(path, token, body) {
  const res = await fetch(base + path, { method: body ? "POST" : "GET", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(310_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(`${path}: HTTP ${res.status} ${data.error ?? ""}`);
  return data;
}
const guest = await api("/api/auth/guest", null, { login: process.env.E2E_GUEST_LOGIN, password: process.env.E2E_GUEST_PASSWORD });
const signed = await db.auth.signInWithPassword({ email: guest.email, password: guest.password });
if (signed.error || !signed.data.session) throw Error("Guest audit sign-in failed");
const token = signed.data.session.access_token, workspaceId = guest.workspaceId;
const projects = await db.from("projects").select("id,name").eq("workspace_id", workspaceId).eq("status", "active").limit(1);
if (projects.error || !projects.data?.length) throw Error("Missing dedicated audit project");
const projectId = projects.data[0].id;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function upload(fileName, mimeType, bytes) {
  // AI may rename documents; the immutable uploaded filename identifies the fixture.
  const existing = await db.from("document_versions").select("document_id,documents!document_versions_document_id_fkey!inner(workspace_id)")
    .eq("documents.workspace_id", workspaceId).eq("project_id", projectId).eq("file_name", fileName)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  const documentId = existing.data?.document_id;
  if (documentId) {
    const document = await db.from("documents").select("deleted_at").eq("id", documentId).eq("workspace_id", workspaceId).single();
    if (document.error) throw document.error;
    if (document.data.deleted_at) await api("/api/storage/document-state", token, { workspaceId, projectId, documentId, state: "active" });
  }
  console.log(`Checking live fixture: ${fileName}`);
  const url = await api("/api/storage/upload-url", token, { workspaceId, projectId, ...(documentId ? { documentId } : {}), fileName, mimeType, fileSize: bytes.length });
  const stored = await fetch(url.uploadUrl, { method: "PUT", headers: url.headers, body: bytes });
  if (!stored.ok) throw Error(`R2 fixture upload failed: ${stored.status}`);
  return api("/api/storage/complete", token, { token: url.token, sha256: sha(bytes) });
}
async function processVersion(versionId) { return api("/api/brain/process", token, { workspaceId, versionId }); }
async function extraction(versionId) {
  const result = await db.from("document_extractions").select("payload").eq("workspace_id", workspaceId).eq("document_version_id", versionId).eq("extraction_type", "document_context").eq("schema_version", "document-analysis-v3").single();
  if (result.error) throw result.error;
  if (result.data.payload.fieldQuality?.version !== "field-quality-v1") throw Error("Detailed field validation was not persisted");
  return result.data.payload;
}
function spreadsheet(bad) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Lp", "Opis", "Ilość", "Jm", "Cena jednostkowa", "Wartość"], [],
    ["1", "Rura testowa DN50", 10, "m", 20, bad ? 0 : 200]
  ]), "Kosztorys");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Lp", "Zadanie", "Start", "Koniec"], ["S1", "Montaż rur", "2026-11-10", bad ? "2026-11-09" : "2026-11-12"]
  ]), "Harmonogram");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}
const summary = [];
for (const bad of [false, true]) {
  const fixture = await upload(`octopus-live-field-quality-${bad ? "conflict" : "valid"}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", spreadsheet(bad));
  await processVersion(fixture.versionId);
  const data = await extraction(fixture.versionId);
  const total = data.fieldQuality.fields.find(field => field.path === "boqItems.0.totalPrice");
  if (!total || total.source?.cell !== "F3") throw Error("Lost physical Excel cell provenance");
  if (bad && (total.status !== "conflict" || !data.fieldQuality.requiresReview)) throw Error("Explicit zero / arithmetic conflict was not caught");
  if (!bad && total.status !== "verified") throw Error("Native Excel value was not verified");
  const proposals = await db.from("document_module_proposals").select("status,payload,proposal_type").eq("document_version_id", fixture.versionId).eq("proposal_type", "boq_item");
  if (proposals.error) throw proposals.error;
  if (bad && proposals.data.some(row => row.status === "published")) throw Error("Conflicting estimate reached publication");
  const view = await api(`/api/documents/quality?workspaceId=${workspaceId}&documentId=${fixture.documentId}`, token);
  if (!view.totalFields || view.report.documentVersionId !== fixture.versionId) throw Error("Quality UI endpoint did not expose the current report");
  const anon = await fetch(`${base}/api/documents/quality?workspaceId=${workspaceId}&documentId=${fixture.documentId}`);
  if (anon.status !== 401) throw Error("Quality endpoint lacks authentication");
  summary.push({ fixture: bad ? "conflicting_excel" : "valid_excel", cell: total.source.cell, status: total.status, fields: data.fieldQuality.fields.length, guarded: bad ? true : undefined });
}
const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const lines of [
  ["INDEPENDENT DOCUMENT 1 - COST ESTIMATE EST-QA-01", "Project Octopus test investment", "Item | Description | Quantity | Unit | Unit price PLN | Total PLN", "1 | Steel pipe DN50 | 10 | m | 20 | 200", "END OF COST ESTIMATE"],
  ["INDEPENDENT DOCUMENT 2 - CONSTRUCTION SCHEDULE SCH-QA-02", "Project Octopus test investment", "Task S1: Pipe installation", "Planned start: 2026-11-10", "Planned finish: 2026-11-12", "END OF SCHEDULE"],
  ["INDEPENDENT DOCUMENT 3 - ACCEPTANCE PROTOCOL PV-QA-03", "Date: 2026-11-12", "Scope: pipe pressure test", "Installation: water supply DN50", "Result: NOT ACCEPTED - leak at joint", "Repair deadline: 2026-11-15", "END OF PROTOCOL"]
]) {
  const page = pdf.addPage([612, 792]); lines.forEach((line, i) => page.drawText(line, { x: 35, y: 740 - i * 35, size: i ? 10 : 12, font }));
}
const bytes = Buffer.from(await pdf.save());
const fixture = await upload("octopus-live-field-quality-mixed.pdf", "application/pdf", bytes);
const processed = await processVersion(fixture.versionId);
if (processed.package?.acceptedEntries !== 3 || processed.package.queuedVersionIds?.length !== 3) throw Error(`Mixed PDF was not split into three documents: ${JSON.stringify(processed.package ?? processed.status)}`);
const children = [];
for (const versionId of processed.package.queuedVersionIds) {
  await processVersion(versionId); const data = await extraction(versionId);
  children.push({ category: data.category, fields: data.fieldQuality.fields.length });
  const origin = await db.from("document_intakes").select("source_metadata").eq("workspace_id", workspaceId).eq("document_id", data.fieldQuality.documentId).single();
  if (origin.error || origin.data.source_metadata.parentVersionId !== fixture.versionId || origin.data.source_metadata.pdfLogicalChild !== true) throw Error("Child lost its original PDF lineage");
}
if (new Set(children.map(child => child.category)).size < 2) throw Error("Independent children were routed as one document type");
const signedUrl = await api("/api/storage/download-url", token, { workspaceId, versionId: fixture.versionId, disposition: "inline" });
const original = Buffer.from(await (await fetch(signedUrl.downloadUrl)).arrayBuffer());
if (sha(original) !== sha(bytes)) throw Error("Original PDF changed during segmentation");
summary.push({ fixture: "mixed_pdf", children, originalPreserved: true });
console.log("LIVE FIELD QUALITY E2E OK"); console.log(JSON.stringify(summary));
