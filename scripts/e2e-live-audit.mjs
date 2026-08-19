import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "E2E_BASE_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing public E2E configuration: ${missing.join(", ")}`);
  process.exit(1);
}

const baseUrl = process.env.E2E_BASE_URL.replace(/\/$/, "");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function minimalPdf(lines) {
  const escaped = lines.map((line) => line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"));
  const text = escaped.map((line, index) => `${index === 0 ? "72 760" : `72 ${760 - index * 24}`} Td (${line}) Tj`).join("\n");
  const stream = `BT /F1 12 Tf\n${text}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function xlsxBuffer() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Pozycja", "Opis", "Ilość", "Jm", "Cena jedn.", "Wartość"],
    ["1.1", "Rura PP-R 32 PN20 instalacja wodociągowa", 120, "m", 18.5, 2220],
    ["1.2", "Zawór kulowy DN32 instalacja wodociągowa", 12, "szt.", 95, 1140],
    ["2.1", "Kanał SPIRO 250 wentylacja", 80, "m", 54, 4320],
    ["INFO", "Project Octopus live audit. Wymagany wniosek materiałowy oraz próba szczelności instalacji.", "", "", "", ""]
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Kosztorys");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function request(path, { token, body, method } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

async function ensureStableDocument(projectId, workspaceId, token, fileName) {
  const { data, error } = await supabase
    .from("documents")
    .select("id,deleted_at")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("name", fileName)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`${fileName}: document lookup failed: ${error.message}`);
  if (!data) return null;
  if (data.deleted_at) {
    const restore = await request("/api/storage/document-state", {
      token,
      body: { workspaceId, projectId, documentId: data.id, state: "active" }
    });
    if (!restore.response.ok) throw new Error(`${fileName}: restore failed: ${restore.response.status} ${JSON.stringify(restore.payload)}`);
  }
  return data.id;
}

async function uploadAndAnalyze({ projectId, workspaceId, token, fileName, mimeType, bytes }) {
  const documentId = await ensureStableDocument(projectId, workspaceId, token, fileName);
  const uploadUrl = await request("/api/storage/upload-url", {
    token,
    body: { workspaceId, projectId, documentId: documentId ?? undefined, fileName, mimeType, fileSize: bytes.length }
  });
  if (!uploadUrl.response.ok) throw new Error(`${fileName}: upload-url ${uploadUrl.response.status} ${JSON.stringify(uploadUrl.payload)}`);

  const put = await fetch(uploadUrl.payload.uploadUrl, {
    method: "PUT",
    headers: uploadUrl.payload.headers,
    body: bytes
  });
  if (!put.ok) throw new Error(`${fileName}: R2 PUT HTTP ${put.status} ${await put.text()}`);

  const complete = await request("/api/storage/complete", {
    token,
    body: { token: uploadUrl.payload.token, sha256: await sha256(bytes) }
  });
  if (!complete.response.ok) throw new Error(`${fileName}: complete ${complete.response.status} ${JSON.stringify(complete.payload)}`);

  const process = await request("/api/brain/process-document", {
    token,
    body: { projectId, documentId: complete.payload.documentId, versionId: complete.payload.versionId }
  });
  if (!process.response.ok) throw new Error(`${fileName}: process ${process.response.status} ${JSON.stringify(process.payload)}`);

  const [{ data: version, error: versionError }, { data: classification, error: classificationError }, { data: extraction, error: extractionError }, { data: job, error: jobError }, { count: sourceCount, error: sourceError }, { count: textCount, error: textError }] = await Promise.all([
    supabase.from("document_versions").select("id,r2_etag,sha256,upload_status,version_number").eq("id", complete.payload.versionId).single(),
    supabase.from("document_classifications").select("category,confidence,model_name,status").eq("document_version_id", complete.payload.versionId).order("created_at", { ascending: false }).limit(1).single(),
    supabase.from("document_extractions").select("status,project_id,payload").eq("document_version_id", complete.payload.versionId).eq("extraction_type", "document_context").single(),
    supabase.from("processing_jobs").select("status,stage,model_name,error_message").eq("document_version_id", complete.payload.versionId).eq("job_type", "document_pipeline").single(),
    supabase.from("source_references").select("id", { count: "exact", head: true }).eq("document_version_id", complete.payload.versionId),
    supabase.from("document_texts").select("id", { count: "exact", head: true }).eq("document_version_id", complete.payload.versionId)
  ]);

  if (versionError || version?.upload_status !== "uploaded" || !version?.r2_etag) throw new Error(`${fileName}: R2 metadata invalid: ${versionError?.message ?? JSON.stringify(version)}`);
  if (classificationError || !String(classification?.model_name ?? "").toLowerCase().includes("gemini")) throw new Error(`${fileName}: Gemini classification missing: ${classificationError?.message ?? JSON.stringify(classification)}`);
  if (extractionError || extraction?.project_id !== projectId) throw new Error(`${fileName}: Brain extraction missing: ${extractionError?.message ?? JSON.stringify(extraction)}`);
  if (jobError || job?.status !== "succeeded" || job?.stage !== "complete" || !String(job?.model_name ?? "").toLowerCase().includes("gemini")) throw new Error(`${fileName}: processing job incomplete: ${jobError?.message ?? JSON.stringify(job)}`);
  if (sourceError || textError || (textCount ?? 0) < 1) throw new Error(`${fileName}: source/text persistence invalid: ${sourceError?.message ?? textError?.message ?? `${sourceCount}/${textCount}`}`);

  const trash = await request("/api/storage/document-state", {
    token,
    body: { workspaceId, projectId, documentId: complete.payload.documentId, state: "trashed" }
  });
  if (!trash.response.ok) throw new Error(`${fileName}: cleanup/trash failed: ${trash.response.status} ${JSON.stringify(trash.payload)}`);

  return {
    fileName,
    category: classification.category,
    confidence: classification.confidence,
    version: version.version_number,
    sourceCount: sourceCount ?? 0,
    textCount: textCount ?? 0
  };
}

const guest = await request("/api/auth/guest", {
  method: "POST",
  body: { login: "gosc", password: "gosc" }
});
if (!guest.response.ok) throw new Error(`Guest bootstrap failed: ${guest.response.status} ${JSON.stringify(guest.payload)}`);

const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
  email: guest.payload.email,
  password: guest.payload.password
});
if (signInError || !session.session) throw new Error(`Guest sign-in failed: ${signInError?.message ?? "missing session"}`);
const token = session.session.access_token;
const workspaceId = guest.payload.workspaceId;

const unauthorized = await request(`/api/company/search?workspaceId=${encodeURIComponent(workspaceId)}&q=Octopus`);
if (unauthorized.response.status !== 401) throw new Error(`Unauthenticated API guard failed: expected 401, got ${unauthorized.response.status}`);

const { data: projects, error: projectsError } = await supabase
  .from("projects")
  .select("id,name,status")
  .eq("workspace_id", workspaceId)
  .order("created_at", { ascending: true })
  .limit(20);
if (projectsError || !projects?.length) throw new Error(`Guest project lookup failed: ${projectsError?.message ?? "no projects"}`);
const project = projects.find((row) => row.status === "active") ?? projects[0];

const search = await request(`/api/company/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(project.name)}`, { token });
if (!search.response.ok || !search.payload.results?.some((row) => row.entity_id === project.id)) throw new Error(`Company search failed: ${search.response.status} ${JSON.stringify(search.payload)}`);

const commandCenter = await request(`/api/projects/command-center?projectId=${encodeURIComponent(project.id)}`, { token });
if (!commandCenter.response.ok || commandCenter.payload.snapshot?.cashflow13w?.length !== 13) throw new Error(`Command Center failed: ${commandCenter.response.status} ${JSON.stringify(commandCenter.payload)}`);

const pdf = minimalPdf([
  "Project Octopus live audit",
  "Instalacja wodociagowa PP-R 32 PN20.",
  "Wymagany wniosek materialowy przed montazem.",
  "Po montazu wymagana proba szczelnosci i protokol odbioru."
]);
const results = [];
results.push(await uploadAndAnalyze({ projectId: project.id, workspaceId, token, fileName: "octopus-live-audit.pdf", mimeType: "application/pdf", bytes: pdf }));
results.push(await uploadAndAnalyze({ projectId: project.id, workspaceId, token, fileName: "octopus-live-audit.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: xlsxBuffer() }));

console.log("LIVE PRODUCTION AUDIT E2E OK");
console.log(JSON.stringify({ workspaceId, projectId: project.id, search: true, commandCenter13w: true, documents: results }));
