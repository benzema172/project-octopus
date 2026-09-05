import "server-only";

import { createHash } from "node:crypto";
import type { DocumentAnalysis } from "@/lib/ai/gemini-document";
import { splitPdfIntoPageChunks, type PdfPageChunk } from "@/lib/ai/pdf-page-chunks";
import { getOptionalEnv, requireServerEnv } from "@/lib/env";
import { normalizeDocumentCategory } from "@/lib/documents/classification";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type WarehouseBusinessLine = DocumentAnalysis["businessDocument"]["lines"][number];
export type WarehouseBusinessDocument = DocumentAnalysis["businessDocument"] & {
  sourcePageStart: number;
  sourcePageEnd: number;
};

export type WarehouseDocumentAnalysis = DocumentAnalysis & {
  businessDocuments: WarehouseBusinessDocument[];
};

type GeminiFile = {
  name: string;
  uri: string;
  mimeType?: string;
  state?: "STATE_UNSPECIFIED" | "PROCESSING" | "ACTIVE" | "FAILED";
  error?: { message?: string };
};

type ChunkCacheRow = {
  status: "queued" | "running" | "succeeded" | "failed";
  attempt_count: number;
  result_json: unknown;
  model_name: string | null;
  error_message: string | null;
};

type ChunkAnalysisResult = {
  analysis: WarehouseDocumentAnalysis;
  model: string;
  pageStart: number;
  pageEnd: number;
  cached: boolean;
};

const RETRYABLE_GEMINI_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const PARSER_VERSION = "warehouse-pdf-chunks-4.2";
const PDF_PAGES_PER_CHUNK = 4;
const PDF_OVERLAP_PAGES = 1;
const PDF_CHUNK_CONCURRENCY = 4;
const MAX_WAREHOUSE_PDF_PAGES = 120;

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

async function geminiRequestWithBackoff(factory: () => Promise<Response>, attempts = 3) {
  let last: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await factory();
      last = response;
      if (response.ok || !RETRYABLE_GEMINI_STATUS.has(response.status) || attempt === attempts) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await delay(Math.min(8_000, 800 * 2 ** (attempt - 1)));
  }
  if (last) return last;
  if (lastError) throw lastError;
  throw new Error("Gemini Warehouse: brak odpowiedzi z API.");
}

const LINE_SCHEMA = {
  type: "OBJECT",
  properties: {
    lineType: { type: "STRING", enum: ["material", "service", "other"] },
    expenseCategory: { type: "STRING" },
    sku: { type: "STRING" }, description: { type: "STRING" }, quantity: { type: "NUMBER" }, unit: { type: "STRING" },
    unitPrice: { type: "NUMBER" }, netAmount: { type: "NUMBER" }, taxRate: { type: "NUMBER" }, grossAmount: { type: "NUMBER" },
    purchaseOrderNumber: { type: "STRING" }, vehicleRegistration: { type: "STRING" }, liters: { type: "NUMBER" }, mileage: { type: "NUMBER" }, confidence: { type: "NUMBER" }
  },
  required: ["lineType", "expenseCategory", "sku", "description", "quantity", "unit", "unitPrice", "netAmount", "taxRate", "grossAmount", "purchaseOrderNumber", "vehicleRegistration", "liters", "mileage", "confidence"]
};

const BUSINESS_DOCUMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    sourcePageStart: { type: "INTEGER" }, sourcePageEnd: { type: "INTEGER" },
    documentType: { type: "STRING", enum: ["invoice", "WZ", "PZ", "delivery"] },
    documentNumber: { type: "STRING" }, ksefNumber: { type: "STRING" }, purchaseOrderNumber: { type: "STRING" },
    direction: { type: "STRING", enum: ["purchase", "sale"] }, issueDate: { type: "STRING" }, dueDate: { type: "STRING" },
    supplierName: { type: "STRING" }, supplierTaxId: { type: "STRING" }, buyerName: { type: "STRING" }, buyerTaxId: { type: "STRING" },
    currency: { type: "STRING" }, netAmount: { type: "NUMBER" }, taxAmount: { type: "NUMBER" }, grossAmount: { type: "NUMBER" },
    lines: { type: "ARRAY", items: LINE_SCHEMA }
  },
  required: ["sourcePageStart", "sourcePageEnd", "documentType", "documentNumber", "ksefNumber", "purchaseOrderNumber", "direction", "issueDate", "dueDate", "supplierName", "supplierTaxId", "buyerName", "buyerTaxId", "currency", "netAmount", "taxAmount", "grossAmount", "lines"]
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", enum: ["warehouse", "invoice", "hr", "fleet", "technical", "contract", "other"] },
    subcategory: { type: "STRING" }, confidence: { type: "NUMBER" }, summary: { type: "STRING" }, projectHint: { type: "STRING" },
    businessDocuments: { type: "ARRAY", items: BUSINESS_DOCUMENT_SCHEMA }, warnings: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["category", "subcategory", "confidence", "summary", "projectHint", "businessDocuments", "warnings"]
};

function bounded(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function positiveInteger(value: unknown) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeLine(value: unknown): WarehouseBusinessLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const line = value as Record<string, unknown>;
  const description = String(line.description ?? "").trim();
  if (!description) return null;
  const rawType = String(line.lineType ?? "other");
  const lineType: WarehouseBusinessLine["lineType"] = ["material", "service", "other"].includes(rawType)
    ? rawType as WarehouseBusinessLine["lineType"]
    : "other";
  return {
    lineType,
    expenseCategory: String(line.expenseCategory ?? "").trim(),
    sku: String(line.sku ?? "").trim(),
    description,
    quantity: Number(line.quantity) || 0,
    unit: String(line.unit ?? "szt.").trim() || "szt.",
    unitPrice: Number(line.unitPrice) || 0,
    netAmount: Number(line.netAmount) || 0,
    taxRate: Number(line.taxRate) || 0,
    grossAmount: Number(line.grossAmount) || 0,
    purchaseOrderNumber: String(line.purchaseOrderNumber ?? "").trim(),
    vehicleRegistration: String(line.vehicleRegistration ?? "").trim(),
    liters: Number(line.liters) || 0,
    mileage: Number(line.mileage) || 0,
    confidence: bounded(line.confidence)
  };
}

function normalizeBusinessDocument(value: unknown): WarehouseBusinessDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const lines = Array.isArray(source.lines)
    ? source.lines.slice(0, 500).map(normalizeLine).filter((line): line is WarehouseBusinessLine => Boolean(line))
    : [];
  const documentNumber = String(source.documentNumber ?? "").trim();
  const supplierName = String(source.supplierName ?? "").trim();
  if (!documentNumber && !supplierName && !lines.length && !Number(source.grossAmount) && !Number(source.netAmount)) return null;
  const type = String(source.documentType ?? "invoice");
  const sourcePageStart = positiveInteger(source.sourcePageStart);
  return {
    sourcePageStart,
    sourcePageEnd: Math.max(sourcePageStart, positiveInteger(source.sourcePageEnd)),
    documentType: ["invoice", "WZ", "PZ", "delivery"].includes(type) ? type : "invoice",
    documentNumber,
    ksefNumber: String(source.ksefNumber ?? "").trim(),
    purchaseOrderNumber: String(source.purchaseOrderNumber ?? "").trim(),
    direction: String(source.direction ?? "purchase") === "sale" ? "sale" : "purchase",
    issueDate: String(source.issueDate ?? "").trim(), dueDate: String(source.dueDate ?? "").trim(),
    supplierName, supplierTaxId: String(source.supplierTaxId ?? "").trim(),
    buyerName: String(source.buyerName ?? "").trim(), buyerTaxId: String(source.buyerTaxId ?? "").trim(),
    currency: String(source.currency ?? "PLN").trim() || "PLN",
    netAmount: Number(source.netAmount) || 0, taxAmount: Number(source.taxAmount) || 0, grossAmount: Number(source.grossAmount) || 0,
    lines
  };
}

function emptyBusinessDocument(): DocumentAnalysis["businessDocument"] {
  return {
    documentType: "", documentNumber: "", ksefNumber: "", purchaseOrderNumber: "", direction: "purchase",
    issueDate: "", dueDate: "", supplierName: "", supplierTaxId: "", buyerName: "", buyerTaxId: "",
    currency: "PLN", netAmount: 0, taxAmount: 0, grossAmount: 0, lines: []
  };
}

function normalizeAnalysis(value: unknown): WarehouseDocumentAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Gemini Warehouse zwrócił nieprawidłową analizę.");
  const source = value as Record<string, unknown>;
  const businessDocuments = Array.isArray(source.businessDocuments)
    ? source.businessDocuments.map(normalizeBusinessDocument).filter((doc): doc is WarehouseBusinessDocument => Boolean(doc))
    : [];
  const aiCategory = normalizeDocumentCategory(typeof source.category === "string" ? source.category : null);
  const category: DocumentAnalysis["category"] = businessDocuments.length ? "warehouse" : (aiCategory ?? "other");
  const confidence = bounded(source.confidence);
  const summary = String(source.summary ?? "").trim() || (businessDocuments.length
    ? `Rozpoznano ${businessDocuments.length} dokumentów finansowo-magazynowych.`
    : "Nie rozpoznano dokumentu magazynowego.");
  const searchPassages = businessDocuments.flatMap((doc) => [
    [doc.documentNumber, doc.supplierName, doc.issueDate].filter(Boolean).join(" · "),
    ...doc.lines.slice(0, 100).map((line) => line.description)
  ]).filter(Boolean).slice(0, 250);
  return {
    category,
    subcategory: String(source.subcategory ?? (businessDocuments.length > 1 ? "Pakiet dokumentów magazynowych" : "Dokument magazynowy")),
    confidence,
    summary,
    projectHint: String(source.projectHint ?? "OGÓLNE").trim() || "OGÓLNE",
    installations: [], workStages: [], requiredProtocols: [], requiredApplications: [], searchPassages,
    businessDocument: businessDocuments[0] ?? emptyBusinessDocument(), businessDocuments,
    boqItems: [], materialRequirements: [], protocolRequirementsDetailed: [], scheduleItems: [], siteEvents: [], progressItems: [], tasks: [], risks: [], facts: [],
    warnings: Array.isArray(source.warnings) ? source.warnings.map(String).slice(0, 100) : []
  };
}

function lineSignature(line: WarehouseBusinessLine) {
  return [
    normalizeToken(line.sku), normalizeToken(line.description), Number(line.quantity).toFixed(5), normalizeToken(line.unit),
    Number(line.unitPrice).toFixed(4), Number(line.netAmount).toFixed(2), Number(line.taxRate).toFixed(3), Number(line.grossAmount).toFixed(2)
  ].join("|");
}

function mergeLines(current: WarehouseBusinessLine[], incoming: WarehouseBusinessLine[]) {
  const result = [...current];
  const currentCounts = new Map<string, number>();
  const incomingGroups = new Map<string, WarehouseBusinessLine[]>();
  for (const line of current) {
    const key = lineSignature(line);
    currentCounts.set(key, (currentCounts.get(key) ?? 0) + 1);
  }
  for (const line of incoming) {
    const key = lineSignature(line);
    incomingGroups.set(key, [...(incomingGroups.get(key) ?? []), line]);
  }
  for (const [key, lines] of incomingGroups) {
    const missing = Math.max(0, lines.length - (currentCounts.get(key) ?? 0));
    if (missing) result.push(...lines.slice(0, missing));
  }
  return result;
}

function suppliersConflict(a: WarehouseBusinessDocument, b: WarehouseBusinessDocument) {
  const taxA = normalizeToken(a.supplierTaxId);
  const taxB = normalizeToken(b.supplierTaxId);
  if (taxA && taxB && taxA !== taxB) return true;
  const nameA = normalizeToken(a.supplierName);
  const nameB = normalizeToken(b.supplierName);
  return Boolean(nameA && nameB && nameA !== nameB && !nameA.includes(nameB) && !nameB.includes(nameA));
}

function pageRangesOverlap(a: WarehouseBusinessDocument, b: WarehouseBusinessDocument) {
  return a.sourcePageStart <= b.sourcePageEnd && b.sourcePageStart <= a.sourcePageEnd;
}

function sameBusinessDocument(a: WarehouseBusinessDocument, b: WarehouseBusinessDocument) {
  if (suppliersConflict(a, b)) return false;
  const ksefA = normalizeToken(a.ksefNumber);
  const ksefB = normalizeToken(b.ksefNumber);
  if (ksefA && ksefB) return ksefA === ksefB;
  const numberA = normalizeToken(a.documentNumber);
  const numberB = normalizeToken(b.documentNumber);
  if (numberA && numberB) return numberA === numberB && normalizeToken(a.documentType) === normalizeToken(b.documentType);
  if (!pageRangesOverlap(a, b)) return false;
  const supplierA = normalizeToken(a.supplierTaxId || a.supplierName);
  const supplierB = normalizeToken(b.supplierTaxId || b.supplierName);
  const sameSupplier = Boolean(supplierA && supplierB && (supplierA === supplierB || supplierA.includes(supplierB) || supplierB.includes(supplierA)));
  const sameDate = Boolean(a.issueDate && b.issueDate && a.issueDate === b.issueDate);
  const sameGross = a.grossAmount > 0 && b.grossAmount > 0 && Math.abs(a.grossAmount - b.grossAmount) < 0.02;
  return sameSupplier && (sameDate || sameGross);
}

function betterText(a: string, b: string) {
  const left = String(a ?? "").trim();
  const right = String(b ?? "").trim();
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function betterAmount(a: number, b: number) {
  if (!Number.isFinite(a) || a === 0) return Number.isFinite(b) ? b : 0;
  if (!Number.isFinite(b) || b === 0) return a;
  return Math.abs(b) > Math.abs(a) ? b : a;
}

function mergeBusinessDocument(a: WarehouseBusinessDocument, b: WarehouseBusinessDocument): WarehouseBusinessDocument {
  return {
    sourcePageStart: Math.min(a.sourcePageStart, b.sourcePageStart),
    sourcePageEnd: Math.max(a.sourcePageEnd, b.sourcePageEnd),
    documentType: betterText(a.documentType, b.documentType),
    documentNumber: betterText(a.documentNumber, b.documentNumber),
    ksefNumber: betterText(a.ksefNumber, b.ksefNumber),
    purchaseOrderNumber: betterText(a.purchaseOrderNumber, b.purchaseOrderNumber),
    direction: a.direction === "sale" || b.direction === "sale" ? "sale" : "purchase",
    issueDate: betterText(a.issueDate, b.issueDate),
    dueDate: betterText(a.dueDate, b.dueDate),
    supplierName: betterText(a.supplierName, b.supplierName),
    supplierTaxId: betterText(a.supplierTaxId, b.supplierTaxId),
    buyerName: betterText(a.buyerName, b.buyerName),
    buyerTaxId: betterText(a.buyerTaxId, b.buyerTaxId),
    currency: betterText(a.currency, b.currency) || "PLN",
    netAmount: betterAmount(a.netAmount, b.netAmount),
    taxAmount: betterAmount(a.taxAmount, b.taxAmount),
    grossAmount: betterAmount(a.grossAmount, b.grossAmount),
    lines: mergeLines(a.lines, b.lines)
  };
}

export function mergeWarehouseBusinessDocuments(input: WarehouseBusinessDocument[]) {
  const documents = [...input].sort((a, b) => a.sourcePageStart - b.sourcePageStart || a.sourcePageEnd - b.sourcePageEnd);
  const merged: WarehouseBusinessDocument[] = [];
  for (const document of documents) {
    const index = merged.findIndex((candidate) => sameBusinessDocument(candidate, document));
    if (index === -1) merged.push({ ...document, lines: [...document.lines] });
    else merged[index] = mergeBusinessDocument(merged[index], document);
  }
  return merged.sort((a, b) => a.sourcePageStart - b.sourcePageStart || a.sourcePageEnd - b.sourcePageEnd);
}

async function uploadFile(input: { fileName: string; mimeType: string; bytes: Buffer }) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const start = await geminiRequestWithBackoff(() => fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(input.bytes.length), "X-Goog-Upload-Header-Content-Type": input.mimeType
    },
    body: JSON.stringify({ file: { displayName: input.fileName } }), signal: AbortSignal.timeout(25_000)
  }));
  if (!start.ok) throw new Error(`Gemini Warehouse nie rozpoczął uploadu: HTTP ${start.status} ${await start.text()}`.slice(0, 600));
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini Warehouse nie zwrócił adresu sesji uploadu.");

  const upload = await geminiRequestWithBackoff(() => fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": String(input.bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: new Uint8Array(input.bytes), signal: AbortSignal.timeout(60_000)
  }));
  if (!upload.ok) throw new Error(`Gemini Warehouse odrzucił upload: HTTP ${upload.status} ${await upload.text()}`.slice(0, 600));
  const payload = await upload.json() as { file?: GeminiFile };
  if (!payload.file?.name || !payload.file.uri) throw new Error("Gemini Warehouse nie zwrócił metadanych pliku.");
  return payload.file;
}

async function waitForFile(file: GeminiFile) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  let current = file;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!current.state || current.state === "ACTIVE") return current;
    if (current.state === "FAILED") throw new Error(current.error?.message ?? "Gemini Warehouse nie przetworzył pliku.");
    await delay(1_000);
    const response = await geminiRequestWithBackoff(() => fetch(`https://generativelanguage.googleapis.com/v1beta/${current.name}`, {
      headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(12_000)
    }), 2);
    if (!response.ok) throw new Error(`Gemini Warehouse: błąd statusu pliku HTTP ${response.status}`);
    current = await response.json() as GeminiFile;
  }
  throw new Error("Gemini Warehouse zbyt długo przygotowuje porcję PDF.");
}

async function deleteFile(name: string) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
    method: "DELETE", headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(10_000)
  }).catch(() => undefined);
}

function modelCandidates() {
  const primary = getOptionalEnv("GEMINI_MODEL") ?? "gemini-3.5-flash";
  const fallback = getOptionalEnv("GEMINI_WAREHOUSE_FALLBACK_MODEL") ?? getOptionalEnv("GEMINI_FALLBACK_MODEL") ?? "gemini-2.5-flash";
  return Array.from(new Set([primary, fallback].filter(Boolean)));
}

async function analyzeUploadedFile(input: {
  fileName: string;
  mimeType: string;
  fileUri?: string;
  extractedText?: string;
  projectCatalog?: string[];
  globalPageStart?: number;
  globalPageEnd?: number;
}) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const projectCatalog = input.projectCatalog?.length ? input.projectCatalog.join("\n") : "Brak inwestycji — użyj OGÓLNE.";
  const pageInstruction = input.globalPageStart && input.globalPageEnd
    ? `Ten plik jest PORCJĄ oryginalnego PDF i odpowiada globalnym stronom ${input.globalPageStart}-${input.globalPageEnd}. sourcePageStart/sourcePageEnd MUSZĄ używać tej globalnej numeracji, nigdy numeracji lokalnej 1..N. Dokument może zaczynać się przed porcją lub kończyć po niej — zwróć wyłącznie dane widoczne w tej porcji; nie wymyślaj brakujących pozycji.`
    : "Analizujesz cały pojedynczy dokument.";
  const prompt = `Jesteś wyspecjalizowanym analizatorem dokumentów Magazynu Project Octopus dla polskiej firmy budowlano-instalacyjnej.\n\n${pageInstruction}\n\nPDF może zawierać wiele odrębnych faktur, WZ, PZ lub dostaw. Zwróć osobny element businessDocuments dla KAŻDEGO dokumentu widocznego w analizowanej porcji. Nigdy nie łącz pozycji, numerów ani kwot różnych faktur. Dla kontynuacji wielostronicowej faktury zachowaj jej prawdziwy numer i dostawcę, gdy są widoczne w nagłówku/stopce.\n\nDla każdego dokumentu podaj sourcePageStart/sourcePageEnd, documentType, numer dokumentu/KSeF/PO, daty, dostawcę i nabywcę z NIP, walutę i kwoty oraz każdą WIDOCZNĄ pozycję dokładnie raz. lineType=material tylko dla fizycznego towaru/materiału/urządzenia/części/narzędzia; service dla robocizny, transportu, najmu i usług; other dla rabatów, korekt i pozycji niejednoznacznych. Nie wymyślaj danych.\n\nJeżeli analizowana część nie zawiera dokumentu magazynowo-finansowego, businessDocuments ma być puste. projectHint ma wskazać dokładnie jeden wiersz katalogu albo OGÓLNE. Nie zgaduj.\n\nKATALOG INWESTYCJI:\n${projectCatalog}\n\nZwróć wyłącznie JSON zgodny ze schematem.`;
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (input.fileUri) parts.push({ fileData: { mimeType: input.mimeType, fileUri: input.fileUri } });
  if (input.extractedText) parts.push({ text: `\nTREŚĆ WYEKSTRAHOWANA:\n${input.extractedText.slice(0, 1_500_000)}` });

  const errors: string[] = [];
  for (const model of modelCandidates()) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.03, maxOutputTokens: 20_000 }
        }),
        signal: AbortSignal.timeout(60_000)
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 450);
        errors.push(`${model}: HTTP ${response.status} ${body}`);
        if (RETRYABLE_GEMINI_STATUS.has(response.status)) continue;
        throw new Error(`Gemini Warehouse ${model} odrzucił analizę: HTTP ${response.status} ${body}`);
      }
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
      if (!text) {
        errors.push(`${model}: pusta odpowiedź`);
        continue;
      }
      try {
        return { analysis: normalizeAnalysis(JSON.parse(text)), model };
      } catch (error) {
        errors.push(`${model}: ${error instanceof Error ? error.message : "nieprawidłowy JSON"}`);
      }
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || /timeout|aborted/i.test(error.message))) {
        errors.push(`${model}: timeout 60 s`);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Gemini Warehouse: żadna z konfiguracji modelu nie przeanalizowała porcji. ${errors.join(" | ")}`.slice(0, 1400));
}

async function readChunkCache(input: {
  documentSha256: string;
  contextSha256: string;
  pageStart: number;
  pageEnd: number;
}) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("warehouse_pdf_ai_chunks")
    .select("status,attempt_count,result_json,model_name,error_message")
    .eq("document_sha256", input.documentSha256)
    .eq("context_sha256", input.contextSha256)
    .eq("parser_version", PARSER_VERSION)
    .eq("page_start", input.pageStart)
    .eq("page_end", input.pageEnd)
    .maybeSingle<ChunkCacheRow>();
  if (error) throw new Error(`Nie udało się odczytać cache porcji PDF: ${error.message}`);
  if (data?.status === "succeeded" && data.result_json) {
    await db.from("warehouse_pdf_ai_chunks").update({ last_used_at: new Date().toISOString() })
      .eq("document_sha256", input.documentSha256)
      .eq("context_sha256", input.contextSha256)
      .eq("parser_version", PARSER_VERSION)
      .eq("page_start", input.pageStart)
      .eq("page_end", input.pageEnd);
    return { analysis: normalizeAnalysis(data.result_json), model: data.model_name ?? "cache" };
  }
  return null;
}

async function markChunkRunning(input: {
  documentSha256: string;
  contextSha256: string;
  pageStart: number;
  pageEnd: number;
}) {
  const db = createServiceSupabaseClient();
  const { data: existing } = await db.from("warehouse_pdf_ai_chunks")
    .select("attempt_count")
    .eq("document_sha256", input.documentSha256)
    .eq("context_sha256", input.contextSha256)
    .eq("parser_version", PARSER_VERSION)
    .eq("page_start", input.pageStart)
    .eq("page_end", input.pageEnd)
    .maybeSingle<{ attempt_count: number }>();
  const now = new Date().toISOString();
  const { error } = await db.from("warehouse_pdf_ai_chunks").upsert({
    document_sha256: input.documentSha256,
    context_sha256: input.contextSha256,
    parser_version: PARSER_VERSION,
    page_start: input.pageStart,
    page_end: input.pageEnd,
    status: "running",
    attempt_count: (existing?.attempt_count ?? 0) + 1,
    result_json: null,
    model_name: null,
    error_message: null,
    started_at: now,
    finished_at: null,
    last_used_at: now,
    updated_at: now
  }, { onConflict: "document_sha256,context_sha256,parser_version,page_start,page_end" });
  if (error) throw new Error(`Nie udało się rozpocząć porcji PDF w cache: ${error.message}`);
}

async function markChunkSucceeded(input: {
  documentSha256: string;
  contextSha256: string;
  pageStart: number;
  pageEnd: number;
  analysis: WarehouseDocumentAnalysis;
  model: string;
}) {
  const now = new Date().toISOString();
  const { error } = await createServiceSupabaseClient().from("warehouse_pdf_ai_chunks").update({
    status: "succeeded",
    result_json: input.analysis,
    model_name: input.model,
    error_message: null,
    finished_at: now,
    last_used_at: now,
    updated_at: now
  })
    .eq("document_sha256", input.documentSha256)
    .eq("context_sha256", input.contextSha256)
    .eq("parser_version", PARSER_VERSION)
    .eq("page_start", input.pageStart)
    .eq("page_end", input.pageEnd);
  if (error) throw new Error(`Nie udało się zapisać wyniku porcji PDF: ${error.message}`);
}

async function markChunkFailed(input: {
  documentSha256: string;
  contextSha256: string;
  pageStart: number;
  pageEnd: number;
  error: unknown;
}) {
  const now = new Date().toISOString();
  const message = input.error instanceof Error ? input.error.message : "Nieznany błąd porcji PDF.";
  await createServiceSupabaseClient().from("warehouse_pdf_ai_chunks").update({
    status: "failed",
    error_message: message.slice(0, 1800),
    finished_at: now,
    last_used_at: now,
    updated_at: now
  })
    .eq("document_sha256", input.documentSha256)
    .eq("context_sha256", input.contextSha256)
    .eq("parser_version", PARSER_VERSION)
    .eq("page_start", input.pageStart)
    .eq("page_end", input.pageEnd);
}

async function analyzePdfChunk(input: {
  chunk: PdfPageChunk;
  fileName: string;
  projectCatalog?: string[];
  documentSha256: string;
  contextSha256: string;
}): Promise<ChunkAnalysisResult> {
  const cached = await readChunkCache({
    documentSha256: input.documentSha256,
    contextSha256: input.contextSha256,
    pageStart: input.chunk.pageStart,
    pageEnd: input.chunk.pageEnd
  });
  if (cached) return { ...cached, pageStart: input.chunk.pageStart, pageEnd: input.chunk.pageEnd, cached: true };

  await markChunkRunning({
    documentSha256: input.documentSha256,
    contextSha256: input.contextSha256,
    pageStart: input.chunk.pageStart,
    pageEnd: input.chunk.pageEnd
  });

  let uploaded: GeminiFile | null = null;
  try {
    uploaded = await uploadFile({
      fileName: `${input.fileName}.pages-${input.chunk.pageStart}-${input.chunk.pageEnd}.pdf`,
      mimeType: "application/pdf",
      bytes: input.chunk.bytes
    });
    const active = await waitForFile(uploaded);
    const result = await analyzeUploadedFile({
      fileName: input.fileName,
      mimeType: active.mimeType ?? "application/pdf",
      fileUri: active.uri,
      projectCatalog: input.projectCatalog,
      globalPageStart: input.chunk.pageStart,
      globalPageEnd: input.chunk.pageEnd
    });
    await markChunkSucceeded({
      documentSha256: input.documentSha256,
      contextSha256: input.contextSha256,
      pageStart: input.chunk.pageStart,
      pageEnd: input.chunk.pageEnd,
      analysis: result.analysis,
      model: result.model
    });
    return { ...result, pageStart: input.chunk.pageStart, pageEnd: input.chunk.pageEnd, cached: false };
  } catch (error) {
    await markChunkFailed({
      documentSha256: input.documentSha256,
      contextSha256: input.contextSha256,
      pageStart: input.chunk.pageStart,
      pageEnd: input.chunk.pageEnd,
      error
    });
    throw error;
  } finally {
    if (uploaded) await deleteFile(uploaded.name);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => run()));
  return results;
}

function mostCommonProjectHint(results: ChunkAnalysisResult[]) {
  const counts = new Map<string, number>();
  for (const result of results) {
    const value = result.analysis.projectHint?.trim() || "OGÓLNE";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "OGÓLNE";
}

function aggregateChunkAnalyses(results: ChunkAnalysisResult[], pageCount: number): WarehouseDocumentAnalysis {
  const businessDocuments = mergeWarehouseBusinessDocuments(results.flatMap((result) => result.analysis.businessDocuments));
  const confidenceValues = results.map((result) => result.analysis.confidence).filter(Number.isFinite);
  const confidence = confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0;
  const warnings = Array.from(new Set(results.flatMap((result) => result.analysis.warnings))).slice(0, 100);
  const searchPassages = businessDocuments.flatMap((doc) => [
    [doc.documentNumber, doc.supplierName, doc.issueDate].filter(Boolean).join(" · "),
    ...doc.lines.map((line) => line.description)
  ]).filter(Boolean).slice(0, 250);
  return {
    category: businessDocuments.length ? "warehouse" : "other",
    subcategory: businessDocuments.length > 1 ? "Pakiet dokumentów magazynowych" : "Dokument magazynowy",
    confidence,
    summary: businessDocuments.length
      ? `Rozpoznano ${businessDocuments.length} dokumentów finansowo-magazynowych na ${pageCount} stronach; PDF przeanalizowano porcjami i scalono.`
      : `Na ${pageCount} stronach nie rozpoznano dokumentu finansowo-magazynowego.`,
    projectHint: mostCommonProjectHint(results),
    installations: [], workStages: [], requiredProtocols: [], requiredApplications: [], searchPassages,
    businessDocument: businessDocuments[0] ?? emptyBusinessDocument(),
    businessDocuments,
    boqItems: [], materialRequirements: [], protocolRequirementsDetailed: [], scheduleItems: [], siteEvents: [], progressItems: [], tasks: [], risks: [], facts: [],
    warnings
  };
}

async function analyzeWarehousePdfInChunks(input: { fileName: string; bytes: Buffer; projectCatalog?: string[] }) {
  const { pageCount, chunks } = await splitPdfIntoPageChunks(input.bytes, PDF_PAGES_PER_CHUNK, PDF_OVERLAP_PAGES);
  if (!pageCount) throw new Error("PDF Magazynu nie zawiera stron.");
  if (pageCount > MAX_WAREHOUSE_PDF_PAGES) throw new Error(`PDF Magazynu ma ${pageCount} stron; limit pojedynczego pliku to ${MAX_WAREHOUSE_PDF_PAGES} stron.`);
  const documentSha256 = sha256(input.bytes);
  const contextSha256 = sha256(JSON.stringify(input.projectCatalog ?? []));

  const settled = await mapWithConcurrency(chunks, PDF_CHUNK_CONCURRENCY, async (chunk) => {
    try {
      const value = await analyzePdfChunk({ chunk, fileName: input.fileName, projectCatalog: input.projectCatalog, documentSha256, contextSha256 });
      return { ok: true as const, value };
    } catch (error) {
      return { ok: false as const, chunk, error };
    }
  });
  const failures = settled.filter((item): item is Extract<(typeof settled)[number], { ok: false }> => !item.ok);
  if (failures.length) {
    const details = failures.map((failure) => `strony ${failure.chunk.pageStart}-${failure.chunk.pageEnd}: ${failure.error instanceof Error ? failure.error.message : "błąd"}`);
    throw new Error(`Nie ukończono ${failures.length}/${chunks.length} porcji PDF. Udane porcje są zapisane i nie będą analizowane ponownie. ${details.join(" | ")}`.slice(0, 1800));
  }
  const results = settled.map((item) => (item as Extract<(typeof settled)[number], { ok: true }>).value);
  const analysis = aggregateChunkAnalyses(results, pageCount);
  const models = Array.from(new Set(results.map((result) => result.model)));
  const cached = results.filter((result) => result.cached).length;
  analysis.warnings = [
    ...analysis.warnings,
    `Pipeline porcjowany: ${chunks.length} porcji, ${cached} odczytanych z cache, ${chunks.length - cached} przeanalizowanych w tej próbie.`
  ].slice(0, 100);
  return { analysis, model: `chunked:${models.join(",") || "cache"}` };
}

export async function analyzeWarehouseDocumentWithGemini(input: { fileName: string; mimeType: string; bytes?: Buffer; extractedText?: string; projectCatalog?: string[] }) {
  if (input.bytes && input.mimeType === "application/pdf") {
    return analyzeWarehousePdfInChunks({ fileName: input.fileName, bytes: input.bytes, projectCatalog: input.projectCatalog });
  }

  const useFileApi = Boolean(input.bytes && input.mimeType.startsWith("image/"));
  if (!useFileApi) return analyzeUploadedFile({ fileName: input.fileName, mimeType: input.mimeType, extractedText: input.extractedText, projectCatalog: input.projectCatalog });

  const uploaded = await uploadFile({ fileName: input.fileName, mimeType: input.mimeType, bytes: input.bytes! });
  try {
    const active = await waitForFile(uploaded);
    return await analyzeUploadedFile({ fileName: input.fileName, mimeType: active.mimeType ?? input.mimeType, fileUri: active.uri, projectCatalog: input.projectCatalog });
  } finally {
    await deleteFile(uploaded.name);
  }
}
