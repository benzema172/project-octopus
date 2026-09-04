import "server-only";

import type { DocumentAnalysis } from "@/lib/ai/gemini-document";
import { getOptionalEnv, requireServerEnv } from "@/lib/env";
import { normalizeDocumentCategory } from "@/lib/documents/classification";

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

const LINE_SCHEMA = {
  type: "OBJECT",
  properties: {
    lineType: { type: "STRING", enum: ["material", "service", "other"] },
    expenseCategory: { type: "STRING" },
    sku: { type: "STRING" },
    description: { type: "STRING" },
    quantity: { type: "NUMBER" },
    unit: { type: "STRING" },
    unitPrice: { type: "NUMBER" },
    netAmount: { type: "NUMBER" },
    taxRate: { type: "NUMBER" },
    grossAmount: { type: "NUMBER" },
    purchaseOrderNumber: { type: "STRING" },
    vehicleRegistration: { type: "STRING" },
    liters: { type: "NUMBER" },
    mileage: { type: "NUMBER" },
    confidence: { type: "NUMBER" }
  },
  required: [
    "lineType", "expenseCategory", "sku", "description", "quantity", "unit",
    "unitPrice", "netAmount", "taxRate", "grossAmount", "purchaseOrderNumber",
    "vehicleRegistration", "liters", "mileage", "confidence"
  ]
};

const BUSINESS_DOCUMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    sourcePageStart: { type: "INTEGER" },
    sourcePageEnd: { type: "INTEGER" },
    documentType: { type: "STRING", enum: ["invoice", "WZ", "PZ", "delivery"] },
    documentNumber: { type: "STRING" },
    ksefNumber: { type: "STRING" },
    purchaseOrderNumber: { type: "STRING" },
    direction: { type: "STRING", enum: ["purchase", "sale"] },
    issueDate: { type: "STRING" },
    dueDate: { type: "STRING" },
    supplierName: { type: "STRING" },
    supplierTaxId: { type: "STRING" },
    buyerName: { type: "STRING" },
    buyerTaxId: { type: "STRING" },
    currency: { type: "STRING" },
    netAmount: { type: "NUMBER" },
    taxAmount: { type: "NUMBER" },
    grossAmount: { type: "NUMBER" },
    lines: { type: "ARRAY", items: LINE_SCHEMA }
  },
  required: [
    "sourcePageStart", "sourcePageEnd", "documentType", "documentNumber", "ksefNumber",
    "purchaseOrderNumber", "direction", "issueDate", "dueDate", "supplierName",
    "supplierTaxId", "buyerName", "buyerTaxId", "currency", "netAmount", "taxAmount",
    "grossAmount", "lines"
  ]
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: {
      type: "STRING",
      enum: ["warehouse", "invoice", "hr", "fleet", "technical", "contract", "other"]
    },
    subcategory: { type: "STRING" },
    confidence: { type: "NUMBER" },
    summary: { type: "STRING" },
    projectHint: { type: "STRING" },
    businessDocuments: { type: "ARRAY", items: BUSINESS_DOCUMENT_SCHEMA },
    warnings: { type: "ARRAY", items: { type: "STRING" } }
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
  const hasBusinessEvidence = Boolean(documentNumber || supplierName || lines.length || Number(source.grossAmount) || Number(source.netAmount));
  if (!hasBusinessEvidence) return null;
  const type = String(source.documentType ?? "invoice");
  const documentType = ["invoice", "WZ", "PZ", "delivery"].includes(type) ? type : "invoice";
  const direction = String(source.direction ?? "purchase") === "sale" ? "sale" : "purchase";
  const sourcePageStart = positiveInteger(source.sourcePageStart);
  const sourcePageEnd = Math.max(sourcePageStart, positiveInteger(source.sourcePageEnd));
  return {
    sourcePageStart,
    sourcePageEnd,
    documentType,
    documentNumber,
    ksefNumber: String(source.ksefNumber ?? "").trim(),
    purchaseOrderNumber: String(source.purchaseOrderNumber ?? "").trim(),
    direction,
    issueDate: String(source.issueDate ?? "").trim(),
    dueDate: String(source.dueDate ?? "").trim(),
    supplierName,
    supplierTaxId: String(source.supplierTaxId ?? "").trim(),
    buyerName: String(source.buyerName ?? "").trim(),
    buyerTaxId: String(source.buyerTaxId ?? "").trim(),
    currency: String(source.currency ?? "PLN").trim() || "PLN",
    netAmount: Number(source.netAmount) || 0,
    taxAmount: Number(source.taxAmount) || 0,
    grossAmount: Number(source.grossAmount) || 0,
    lines
  };
}

function emptyBusinessDocument(): DocumentAnalysis["businessDocument"] {
  return {
    documentType: "",
    documentNumber: "",
    ksefNumber: "",
    purchaseOrderNumber: "",
    direction: "purchase",
    issueDate: "",
    dueDate: "",
    supplierName: "",
    supplierTaxId: "",
    buyerName: "",
    buyerTaxId: "",
    currency: "PLN",
    netAmount: 0,
    taxAmount: 0,
    grossAmount: 0,
    lines: []
  };
}

function normalizeAnalysis(value: unknown): WarehouseDocumentAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gemini Warehouse zwrócił nieprawidłową analizę.");
  }
  const source = value as Record<string, unknown>;
  const businessDocuments = Array.isArray(source.businessDocuments)
    ? source.businessDocuments.map(normalizeBusinessDocument).filter((doc): doc is WarehouseBusinessDocument => Boolean(doc))
    : [];
  const aiCategory = normalizeDocumentCategory(source.category);
  const category = businessDocuments.length ? "warehouse" : (aiCategory ?? "other");
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
    installations: [],
    workStages: [],
    requiredProtocols: [],
    requiredApplications: [],
    searchPassages,
    businessDocument: businessDocuments[0] ?? emptyBusinessDocument(),
    businessDocuments,
    boqItems: [],
    materialRequirements: [],
    protocolRequirementsDetailed: [],
    scheduleItems: [],
    siteEvents: [],
    progressItems: [],
    tasks: [],
    risks: [],
    facts: [],
    warnings: Array.isArray(source.warnings) ? source.warnings.map((item) => String(item)).slice(0, 100) : []
  };
}

async function uploadFile(input: { fileName: string; mimeType: string; bytes: Buffer }) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(input.bytes.length),
      "X-Goog-Upload-Header-Content-Type": input.mimeType
    },
    body: JSON.stringify({ file: { displayName: input.fileName } }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!start.ok) throw new Error(`Gemini Warehouse nie rozpoczął uploadu: HTTP ${start.status} ${await start.text()}`.slice(0, 500));
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini Warehouse nie zwrócił adresu sesji uploadu.");

  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(input.bytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: new Uint8Array(input.bytes),
    signal: AbortSignal.timeout(90_000)
  });
  if (!upload.ok) throw new Error(`Gemini Warehouse odrzucił upload: HTTP ${upload.status}`);
  const payload = await upload.json() as { file?: GeminiFile };
  if (!payload.file?.name || !payload.file.uri) throw new Error("Gemini Warehouse nie zwrócił metadanych pliku.");
  return payload.file;
}

async function waitForFile(file: GeminiFile) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  let current = file;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (!current.state || current.state === "ACTIVE") return current;
    if (current.state === "FAILED") throw new Error(current.error?.message ?? "Gemini Warehouse nie przetworzył pliku.");
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${current.name}`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Gemini Warehouse: błąd statusu pliku HTTP ${response.status}`);
    current = await response.json() as GeminiFile;
  }
  throw new Error("Gemini Warehouse zbyt długo przygotowuje plik; zadanie zostanie ponowione.");
}

async function deleteFile(name: string) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
    method: "DELETE",
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(15_000)
  }).catch(() => undefined);
}

async function analyze(input: {
  fileName: string;
  mimeType: string;
  fileUri?: string;
  extractedText?: string;
  projectCatalog?: string[];
}) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const model = getOptionalEnv("GEMINI_MODEL") ?? "gemini-3.5-flash";
  const projectCatalog = input.projectCatalog?.length ? input.projectCatalog.join("\n") : "Brak inwestycji — użyj OGÓLNE.";
  const prompt = `Jesteś wyspecjalizowanym analizatorem dokumentów Magazynu Project Octopus dla polskiej firmy budowlano-instalacyjnej.

Najważniejsza zasada: jeden przesłany PDF może zawierać WIELE odrębnych faktur, WZ, PZ lub dokumentów dostawy. Najpierw rozpoznaj granice każdego dokumentu, a następnie zwróć osobny element businessDocuments dla KAŻDEGO wykrytego dokumentu, w kolejności stron. Nigdy nie łącz pozycji, numerów ani kwot z różnych faktur w jeden rekord.

Dla każdego businessDocuments:
- sourcePageStart/sourcePageEnd: rzeczywisty zakres stron tego dokumentu w przesłanym pliku (numeracja od 1),
- documentType: invoice, WZ, PZ albo delivery,
- documentNumber, KSeF, numer PO/zamówienia, daty, dostawcę/odbiorcę i NIP-y,
- kwoty netto/VAT/brutto i walutę,
- KAŻDĄ pozycję dokumentu dokładnie raz.

Dla linii ustaw lineType=material wyłącznie dla fizycznego towaru, materiału, urządzenia, części lub narzędzia; service dla robocizny, transportu, najmu i innych usług; other dla rabatów, korekt i niejednoznacznych pozycji. Nie oznaczaj usługi jako materiał tylko dlatego, że ma ilość i cenę. Odczytaj SKU, ilość, jednostkę, cenę jednostkową, netto, VAT i brutto. Nie wymyślaj brakujących danych. Dla paliwa numer rejestracyjny, litry i przebieg podawaj tylko wtedy, gdy są widoczne.

Jeżeli dokument na kolejnej stronie jest nową fakturą (inny numer, dostawca, nagłówek lub logiczny początek dokumentu), MUSI otrzymać osobny element businessDocuments. Jeżeli jedna faktura zajmuje kilka stron, zachowaj ją jako jeden element i podaj pełny zakres stron.

Jeżeli plik nie jest dokumentem magazynowo-finansowym, businessDocuments ma być puste i ustaw rzeczywistą kategorię. projectHint ma wskazać dokładnie jeden wiersz z katalogu inwestycji albo OGÓLNE; nie zgaduj.

KATALOG INWESTYCJI:
${projectCatalog}

Zwróć wyłącznie JSON zgodny ze schematem.`;
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (input.fileUri) parts.push({ fileData: { mimeType: input.mimeType, fileUri: input.fileUri } });
  if (input.extractedText) parts.push({ text: `\nTREŚĆ WYEKSTRAHOWANA:\n${input.extractedText.slice(0, 1_500_000)}` });

  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.05,
          maxOutputTokens: 32_768
        }
      }),
      signal: AbortSignal.timeout(140_000)
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || /timeout|aborted/i.test(error.message))) {
      throw new Error("Gemini Warehouse przekroczył limit 140 s podczas analizy; zadanie zostanie ponowione przez kolejkę.");
    }
    throw error;
  }
  if (!response.ok) throw new Error(`Gemini Warehouse odrzucił analizę: HTTP ${response.status} ${await response.text()}`.slice(0, 700));
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini Warehouse nie zwrócił treści analizy.");
  return { analysis: normalizeAnalysis(JSON.parse(text)), model };
}

export async function analyzeWarehouseDocumentWithGemini(input: {
  fileName: string;
  mimeType: string;
  bytes?: Buffer;
  extractedText?: string;
  projectCatalog?: string[];
}) {
  const useFileApi = Boolean(input.bytes && (input.mimeType === "application/pdf" || input.mimeType.startsWith("image/")));
  if (!useFileApi) {
    return analyze({
      fileName: input.fileName,
      mimeType: input.mimeType,
      extractedText: input.extractedText,
      projectCatalog: input.projectCatalog
    });
  }

  const uploaded = await uploadFile({ fileName: input.fileName, mimeType: input.mimeType, bytes: input.bytes! });
  try {
    const active = await waitForFile(uploaded);
    return await analyze({
      fileName: input.fileName,
      mimeType: active.mimeType ?? input.mimeType,
      fileUri: active.uri,
      projectCatalog: input.projectCatalog
    });
  } finally {
    await deleteFile(uploaded.name);
  }
}
