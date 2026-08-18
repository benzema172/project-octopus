import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const requiredEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "GEMINI_API_KEY"
];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  console.error(`Missing environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const testId = randomUUID();
const email = `octopus-r2-gemini-${testId}@example.com`;
const password = `Octopus-${testId}-2026!`;
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const publicClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
let userId = null;
let workspaceId = null;

function minimalPdf(lines) {
  const escaped = lines.map((line) => line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"));
  const text = escaped.map((line, index) => `${index === 0 ? "72 760" : `72 ${760 - index * 24}`} Td (${line}) Tj`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(`BT /F1 12 Tf\n${text}\nET`)} >>\nstream\nBT /F1 12 Tf\n${text}\nET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
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
    ["INFO", "Inwestycja E2E Project Octopus. Wymagany wniosek materiałowy dla rur PP-R oraz próba szczelności instalacji.", "", "", "", ""]
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Kosztorys");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function api(path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

async function uploadAndAnalyze({ projectId, token, fileName, mimeType, bytes }) {
  const uploadUrlResponse = await api("/api/storage/upload-url", token, { projectId, fileName, mimeType, fileSize: bytes.length });
  if (!uploadUrlResponse.response.ok) throw new Error(`Upload URL ${fileName}: ${uploadUrlResponse.response.status} ${JSON.stringify(uploadUrlResponse.payload)}`);
  const upload = uploadUrlResponse.payload;
  const putResponse = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: bytes });
  if (!putResponse.ok) throw new Error(`R2 PUT ${fileName}: HTTP ${putResponse.status} ${await putResponse.text()}`);
  const complete = await api("/api/storage/complete", token, { token: upload.token, sha256: await sha256(bytes) });
  if (!complete.response.ok) throw new Error(`Complete ${fileName}: ${complete.response.status} ${JSON.stringify(complete.payload)}`);
  const process = await api("/api/brain/process-document", token, {
    projectId,
    documentId: complete.payload.documentId,
    versionId: complete.payload.versionId
  });
  if (!process.response.ok) throw new Error(`Gemini ${fileName}: ${process.response.status} ${JSON.stringify(process.payload)}`);

  const [{ data: version, error: versionError }, { data: classification, error: classificationError }, { data: extraction, error: extractionError }, { data: job, error: jobError }, { count: sourceCount, error: sourceError }] = await Promise.all([
    admin.from("document_versions").select("id,r2_object_key,r2_etag,sha256,upload_status,version_number").eq("id", complete.payload.versionId).single(),
    admin.from("document_classifications").select("category,confidence,model_name,status,proposed_project_id").eq("document_version_id", complete.payload.versionId).order("created_at", { ascending: false }).limit(1).single(),
    admin.from("document_extractions").select("status,project_id,payload").eq("document_version_id", complete.payload.versionId).eq("extraction_type", "document_context").single(),
    admin.from("processing_jobs").select("status,stage,model_name,error_message").eq("document_version_id", complete.payload.versionId).eq("job_type", "document_pipeline").single(),
    admin.from("source_references").select("id", { count: "exact", head: true }).eq("document_version_id", complete.payload.versionId)
  ]);
  if (versionError || !version || version.upload_status !== "uploaded" || !version.r2_etag) throw new Error(`${fileName}: R2 metadata invalid: ${versionError?.message ?? "missing"}`);
  if (classificationError || !classification || !String(classification.model_name ?? "").toLowerCase().includes("gemini")) throw new Error(`${fileName}: Gemini classification missing: ${classificationError?.message ?? JSON.stringify(classification)}`);
  if (extractionError || !extraction || extraction.project_id !== projectId) throw new Error(`${fileName}: Brain extraction missing: ${extractionError?.message ?? JSON.stringify(extraction)}`);
  if (jobError || !job || job.status !== "succeeded" || job.stage !== "complete" || !String(job.model_name ?? "").toLowerCase().includes("gemini")) throw new Error(`${fileName}: processing job not complete: ${jobError?.message ?? JSON.stringify(job)}`);
  if (sourceError) throw new Error(`${fileName}: source reference verification failed: ${sourceError.message}`);
  return { fileName, documentId: complete.payload.documentId, category: classification.category, confidence: classification.confidence, sourceCount: sourceCount ?? 0, counts: process.payload.counts };
}

try {
  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createUserError || !createdUser.user) throw new Error(`Could not create test user: ${createUserError?.message ?? "missing user"}`);
  userId = createdUser.user.id;
  const { data: sessionData, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
  if (signInError || !sessionData.session) throw new Error(`Could not sign in test user: ${signInError?.message ?? "missing session"}`);
  const token = sessionData.session.access_token;

  const { data: workspace, error: workspaceError } = await admin.from("workspaces").insert({ name: `R2 Gemini E2E ${testId}`, owner_id: userId }).select("id").single();
  if (workspaceError || !workspace) throw new Error(`Workspace: ${workspaceError?.message ?? "missing"}`);
  workspaceId = workspace.id;
  const { error: memberError } = await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: "owner" });
  if (memberError) throw new Error(`Membership: ${memberError.message}`);
  const { data: project, error: projectError } = await admin.from("projects").insert({ workspace_id: workspaceId, name: `E2E Project Octopus ${testId}`, status: "active", created_by: userId }).select("id").single();
  if (projectError || !project) throw new Error(`Project: ${projectError?.message ?? "missing"}`);

  const pdf = minimalPdf([
    `Project Octopus E2E ${testId}`,
    "Instalacja wodociagowa PP-R 32 PN20.",
    "Wymagany wniosek materialowy przed montazem.",
    "Po montazu wymagana proba szczelnosci i protokol odbioru."
  ]);
  const results = [];
  results.push(await uploadAndAnalyze({ projectId: project.id, token, fileName: `octopus-e2e-${testId}.pdf`, mimeType: "application/pdf", bytes: pdf }));
  results.push(await uploadAndAnalyze({ projectId: project.id, token, fileName: `octopus-e2e-${testId}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: xlsxBuffer() }));

  const [{ count: facts }, { count: requirements }, { count: protocolRequirements }, { count: texts }] = await Promise.all([
    admin.from("project_facts").select("id", { count: "exact", head: true }).eq("project_id", project.id),
    admin.from("project_requirements").select("id", { count: "exact", head: true }).eq("project_id", project.id),
    admin.from("protocol_requirements").select("id", { count: "exact", head: true }).eq("project_id", project.id),
    admin.from("document_texts").select("id", { count: "exact", head: true }).eq("project_id", project.id)
  ]);
  if ((texts ?? 0) < 2) throw new Error(`Brain searchable texts incomplete: ${texts ?? 0}/2`);
  if ((facts ?? 0) + (requirements ?? 0) + (protocolRequirements ?? 0) < 1) throw new Error("Gemini completed, but did not persist any Project DNA facts/requirements/protocol requirements.");

  console.log("R2 → Gemini → Brain E2E OK");
  for (const result of results) console.log(JSON.stringify(result));
  console.log(JSON.stringify({ facts, requirements, protocolRequirements, texts }));
} finally {
  try { if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId); } catch {}
  try { if (userId) await admin.auth.admin.deleteUser(userId); } catch {}
}
