import "server-only";

import { getOptionalEnv, requireServerEnv } from "@/lib/env";
import { DOCUMENT_DESTINATIONS, type DocumentCategory } from "@/lib/documents/classification";

export type AnalysisSource = { page_number: number | null; quote: string };
export type GeminiDocumentAnalysis = {
  category: DocumentCategory;
  confidence: number;
  summary: string;
  extracted_text: string;
  facts: Array<AnalysisSource & { fact_type: string; value_text: string; confidence: number }>;
  materials: Array<AnalysisSource & { name: string; installation: string; specification: string }>;
  devices: Array<AnalysisSource & { name: string; installation: string; parameters: Array<{ key: string; value: string }> }>;
  boq_items: Array<AnalysisSource & { item_number: string; description: string; quantity: number | null; unit: string; unit_price: number | null; total_price: number | null }>;
  findings: Array<AnalysisSource & { severity: "info" | "warning" | "critical"; title: string; description: string }>;
};

type GeminiUploadedFile = { name: string; uri: string; mimeType: string };
const CATEGORY_ENUM: string[] = DOCUMENT_DESTINATIONS.map((item) => item.value);
const CATEGORY_SET = new Set<string>(CATEGORY_ENUM);

const sourceProperties = {
  page_number: { type: ["integer", "null"] },
  quote: { type: "string" }
};

const analysisSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORY_ENUM },
    confidence: { type: "number" },
    summary: { type: "string" },
    extracted_text: { type: "string" },
    facts: { type: "array", items: { type: "object", properties: { fact_type: { type: "string" }, value_text: { type: "string" }, confidence: { type: "number" }, ...sourceProperties }, required: ["fact_type", "value_text", "confidence", "page_number", "quote"] } },
    materials: { type: "array", items: { type: "object", properties: { name: { type: "string" }, installation: { type: "string" }, specification: { type: "string" }, ...sourceProperties }, required: ["name", "installation", "specification", "page_number", "quote"] } },
    devices: { type: "array", items: { type: "object", properties: { name: { type: "string" }, installation: { type: "string" }, parameters: { type: "array", items: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] } }, ...sourceProperties }, required: ["name", "installation", "parameters", "page_number", "quote"] } },
    boq_items: { type: "array", items: { type: "object", properties: { item_number: { type: "string" }, description: { type: "string" }, quantity: { type: ["number", "null"] }, unit: { type: "string" }, unit_price: { type: ["number", "null"] }, total_price: { type: ["number", "null"] }, ...sourceProperties }, required: ["item_number", "description", "quantity", "unit", "unit_price", "total_price", "page_number", "quote"] } },
    findings: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["info", "warning", "critical"] }, title: { type: "string" }, description: { type: "string" }, ...sourceProperties }, required: ["severity", "title", "description", "page_number", "quote"] } }
  },
  required: ["category", "confidence", "summary", "extracted_text", "facts", "materials", "devices", "boq_items", "findings"]
};

function promptForDocument(fileName: string, existingCategory: string | null, includeTranscription: boolean) {
  return `Jesteś silnikiem analizy dokumentów Project Octopus dla inwestycji budowlanych.\nPLIK: ${fileName}\nWSTĘPNA KATEGORIA: ${existingCategory ?? "brak"}\n\nRozpoznaj kategorię spośród: ${CATEGORY_ENUM.join(", ")}. Wyciągnij fakty kontraktowe i techniczne, materiały, urządzenia, pozycje kosztorysowe oraz ryzyka/braki. Każdy element musi mieć krótki cytat źródłowy i numer strony tylko wtedy, gdy da się go wiarygodnie ustalić. Nie wymyślaj danych. Confidence 0..1. ${includeTranscription ? "W extracted_text zwróć możliwie pełną transkrypcję dokumentu, maksymalnie około 60 000 znaków." : "Pole extracted_text pozostaw puste, bo tekst został wyekstrahowany lokalnie."} Priorytet: precyzyjne dane przydatne do prowadzenia budowy, nie ogólne opisy.`;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeAnalysis(value: unknown): GeminiDocumentAnalysis {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const categoryValue = String(raw.category ?? "");
  const category = CATEGORY_SET.has(categoryValue) ? categoryValue as DocumentCategory : "do_weryfikacji";
  const list = (key: string) => Array.isArray(raw[key]) ? raw[key] as Array<Record<string, unknown>> : [];
  const source = (item: Record<string, unknown>): AnalysisSource => ({ page_number: numberOrNull(item.page_number), quote: String(item.quote ?? "").slice(0, 700) });
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));

  return {
    category,
    confidence,
    summary: String(raw.summary ?? "").slice(0, 6_000),
    extracted_text: String(raw.extracted_text ?? "").slice(0, 80_000),
    facts: list("facts").slice(0, 120).map((item) => ({ ...source(item), fact_type: String(item.fact_type ?? "informacja").slice(0, 120), value_text: String(item.value_text ?? "").slice(0, 4_000), confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)) })),
    materials: list("materials").slice(0, 120).map((item) => ({ ...source(item), name: String(item.name ?? "").slice(0, 300), installation: String(item.installation ?? "").slice(0, 300), specification: String(item.specification ?? "").slice(0, 2_000) })),
    devices: list("devices").slice(0, 100).map((item) => ({ ...source(item), name: String(item.name ?? "").slice(0, 300), installation: String(item.installation ?? "").slice(0, 300), parameters: (Array.isArray(item.parameters) ? item.parameters : []).slice(0, 30).map((parameter) => { const row = parameter && typeof parameter === "object" ? parameter as Record<string, unknown> : {}; return { key: String(row.key ?? "").slice(0, 160), value: String(row.value ?? "").slice(0, 500) }; }) })),
    boq_items: list("boq_items").slice(0, 300).map((item) => ({ ...source(item), item_number: String(item.item_number ?? "").slice(0, 100), description: String(item.description ?? "").slice(0, 2_000), quantity: numberOrNull(item.quantity), unit: String(item.unit ?? "").slice(0, 80), unit_price: numberOrNull(item.unit_price), total_price: numberOrNull(item.total_price) })),
    findings: list("findings").slice(0, 80).map((item) => ({ ...source(item), severity: String(item.severity) === "critical" ? "critical" : String(item.severity) === "warning" ? "warning" : "info", title: String(item.title ?? "").slice(0, 300), description: String(item.description ?? "").slice(0, 2_000) }))
  };
}

async function uploadGeminiFile(buffer: Buffer, fileName: string, mimeType: string, apiKey: string): Promise<GeminiUploadedFile> {
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", { method: "POST", headers: { "x-goog-api-key": apiKey, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(buffer.length), "X-Goog-Upload-Header-Content-Type": mimeType, "Content-Type": "application/json" }, body: JSON.stringify({ file: { display_name: fileName.slice(0, 500) } }) });
  if (!start.ok) throw new Error(`Gemini nie przygotował uploadu PDF: HTTP ${start.status}`);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini nie zwrócił adresu uploadu pliku.");
  const upload = await fetch(uploadUrl, { method: "POST", headers: { "Content-Length": String(buffer.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: new Uint8Array(buffer) });
  if (!upload.ok) throw new Error(`Gemini odrzucił plik PDF: HTTP ${upload.status}`);
  const payload = await upload.json() as { file?: { name?: string; uri?: string; mimeType?: string; mime_type?: string } };
  if (!payload.file?.name || !payload.file.uri) throw new Error("Gemini nie zwrócił identyfikatora pliku.");
  return { name: payload.file.name, uri: payload.file.uri, mimeType: payload.file.mimeType ?? payload.file.mime_type ?? mimeType };
}

async function deleteGeminiFile(name: string, apiKey: string) {
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": apiKey } }).catch(() => undefined);
}

async function generateStructuredAnalysis(parts: Array<Record<string, unknown>>, apiKey: string) {
  const model = getOptionalEnv("GEMINI_MODEL") ?? "gemini-2.5-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseFormat: { text: { mimeType: "application/json", schema: analysisSchema } } } }) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Gemini analysis failed: HTTP ${response.status}${detail ? ` · ${detail.slice(0, 500)}` : ""}`); }
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini nie zwrócił analizy dokumentu.");
  return normalizeAnalysis(JSON.parse(text));
}

export async function analyzeDocumentWithGemini(input: { fileName: string; mimeType: string; existingCategory: string | null; extractedText: string | null; pdfBuffer: Buffer | null }) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const prompt = promptForDocument(input.fileName, input.existingCategory, Boolean(input.pdfBuffer));
  if (input.pdfBuffer) {
    const uploaded = await uploadGeminiFile(input.pdfBuffer, input.fileName, "application/pdf", apiKey);
    try { return await generateStructuredAnalysis([{ text: prompt }, { file_data: { mime_type: uploaded.mimeType, file_uri: uploaded.uri } }], apiKey); }
    finally { await deleteGeminiFile(uploaded.name, apiKey); }
  }
  return generateStructuredAnalysis([{ text: `${prompt}\n\n--- WYEKSTRAHOWANA TREŚĆ ---\n${input.extractedText ?? ""}` }], apiKey);
}
