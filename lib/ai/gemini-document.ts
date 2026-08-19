import "server-only";

import { getOptionalEnv, requireServerEnv } from "@/lib/env";

export type DocumentAnalysis = {
  category: string;
  subcategory: string;
  confidence: number;
  summary: string;
  projectHint: string;
  installations: string[];
  workStages: string[];
  requiredProtocols: string[];
  requiredApplications: string[];
  searchPassages: string[];
  businessDocument: {
    documentType: string;
    documentNumber: string;
    ksefNumber: string;
    purchaseOrderNumber: string;
    direction: string;
    issueDate: string;
    dueDate: string;
    supplierName: string;
    supplierTaxId: string;
    buyerName: string;
    buyerTaxId: string;
    currency: string;
    netAmount: number;
    taxAmount: number;
    grossAmount: number;
    lines: Array<{
      lineType: "material" | "service" | "other";
      expenseCategory: string;
      sku: string;
      description: string;
      quantity: number;
      unit: string;
      unitPrice: number;
      netAmount: number;
      taxRate: number;
      grossAmount: number;
      purchaseOrderNumber: string;
      vehicleRegistration: string;
      liters: number;
      mileage: number;
      confidence: number;
    }>;
  };
  boqItems: Array<{
    itemNumber: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    wbsCode: string;
    confidence: number;
  }>;
  facts: Array<{ type: string; label: string; value: string; unit: string; confidence: number; locator: string; quote: string }>;
  warnings: string[];
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", enum: ["project", "specification", "estimate", "invoice", "protocol", "application", "template", "hr", "fleet", "warehouse", "report", "other"] },
    subcategory: { type: "STRING" },
    confidence: { type: "NUMBER" },
    summary: { type: "STRING" },
    projectHint: { type: "STRING" },
    installations: { type: "ARRAY", items: { type: "STRING" } },
    workStages: { type: "ARRAY", items: { type: "STRING" } },
    requiredProtocols: { type: "ARRAY", items: { type: "STRING" } },
    requiredApplications: { type: "ARRAY", items: { type: "STRING" } },
    searchPassages: { type: "ARRAY", items: { type: "STRING" } },
    businessDocument: {
      type: "OBJECT",
      properties: {
        documentType: { type: "STRING" }, documentNumber: { type: "STRING" }, ksefNumber: { type: "STRING" }, purchaseOrderNumber: { type: "STRING" }, direction: { type: "STRING" },
        issueDate: { type: "STRING" }, dueDate: { type: "STRING" }, supplierName: { type: "STRING" },
        supplierTaxId: { type: "STRING" }, buyerName: { type: "STRING" }, buyerTaxId: { type: "STRING" },
        currency: { type: "STRING" }, netAmount: { type: "NUMBER" }, taxAmount: { type: "NUMBER" }, grossAmount: { type: "NUMBER" },
        lines: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              lineType: { type: "STRING", enum: ["material", "service", "other"] },
              expenseCategory: { type: "STRING", enum: ["", "material", "fuel", "transport", "equipment", "subcontract", "rental", "service", "other"] },
              sku: { type: "STRING" }, description: { type: "STRING" }, quantity: { type: "NUMBER" }, unit: { type: "STRING" },
              unitPrice: { type: "NUMBER" }, netAmount: { type: "NUMBER" }, taxRate: { type: "NUMBER" }, grossAmount: { type: "NUMBER" },
              purchaseOrderNumber: { type: "STRING" }, vehicleRegistration: { type: "STRING" }, liters: { type: "NUMBER" }, mileage: { type: "NUMBER" }, confidence: { type: "NUMBER" }
            },
            required: ["lineType", "expenseCategory", "sku", "description", "quantity", "unit", "unitPrice", "netAmount", "taxRate", "grossAmount", "purchaseOrderNumber", "vehicleRegistration", "liters", "mileage", "confidence"]
          }
        }
      },
      required: ["documentType", "documentNumber", "ksefNumber", "purchaseOrderNumber", "direction", "issueDate", "dueDate", "supplierName", "supplierTaxId", "buyerName", "buyerTaxId", "currency", "netAmount", "taxAmount", "grossAmount", "lines"]
    },
    boqItems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          itemNumber: { type: "STRING" }, description: { type: "STRING" }, quantity: { type: "NUMBER" },
          unit: { type: "STRING" }, unitPrice: { type: "NUMBER" }, totalPrice: { type: "NUMBER" },
          wbsCode: { type: "STRING" }, confidence: { type: "NUMBER" }
        },
        required: ["itemNumber", "description", "quantity", "unit", "unitPrice", "totalPrice", "wbsCode", "confidence"]
      }
    },
    facts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING" }, label: { type: "STRING" }, value: { type: "STRING" }, unit: { type: "STRING" },
          confidence: { type: "NUMBER" }, locator: { type: "STRING" }, quote: { type: "STRING" }
        },
        required: ["type", "label", "value", "unit", "confidence", "locator", "quote"]
      }
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["category", "subcategory", "confidence", "summary", "projectHint", "installations", "workStages", "requiredProtocols", "requiredApplications", "searchPassages", "businessDocument", "boqItems", "facts", "warnings"]
};

type AnalyzeInput = { fileName: string; mimeType: string; extractedText?: string; inlineData?: string; fileUri?: string; projectCatalog?: string[] };

type GeminiFile = {
  name: string;
  uri: string;
  mimeType?: string;
  state?: "STATE_UNSPECIFIED" | "PROCESSING" | "ACTIVE" | "FAILED";
  error?: { message?: string };
};

function normalizeAnalysis(value: unknown): DocumentAnalysis {
  if (!value || typeof value !== "object") throw new Error("Gemini zwrócił nieprawidłową analizę.");
  const source = value as Partial<DocumentAnalysis>;
  if (!source.category || !source.summary || typeof source.confidence !== "number") throw new Error("Analiza Gemini nie zawiera wymaganych pól.");
  return {
    category: source.category,
    subcategory: source.subcategory ?? "",
    confidence: Math.max(0, Math.min(1, source.confidence)),
    summary: source.summary,
    projectHint: source.projectHint ?? "",
    installations: Array.isArray(source.installations) ? source.installations.map(String) : [],
    workStages: Array.isArray(source.workStages) ? source.workStages.map(String) : [],
    requiredProtocols: Array.isArray(source.requiredProtocols) ? source.requiredProtocols.map(String) : [],
    requiredApplications: Array.isArray(source.requiredApplications) ? source.requiredApplications.map(String) : [],
    searchPassages: Array.isArray(source.searchPassages) ? source.searchPassages.slice(0, 250).map(String) : [],
    businessDocument: {
      documentType: String(source.businessDocument?.documentType ?? ""),
      documentNumber: String(source.businessDocument?.documentNumber ?? ""),
      ksefNumber: String(source.businessDocument?.ksefNumber ?? ""),
      purchaseOrderNumber: String(source.businessDocument?.purchaseOrderNumber ?? ""),
      direction: String(source.businessDocument?.direction ?? "purchase"),
      issueDate: String(source.businessDocument?.issueDate ?? ""),
      dueDate: String(source.businessDocument?.dueDate ?? ""),
      supplierName: String(source.businessDocument?.supplierName ?? ""),
      supplierTaxId: String(source.businessDocument?.supplierTaxId ?? ""),
      buyerName: String(source.businessDocument?.buyerName ?? ""),
      buyerTaxId: String(source.businessDocument?.buyerTaxId ?? ""),
      currency: String(source.businessDocument?.currency ?? "PLN"),
      netAmount: Number(source.businessDocument?.netAmount) || 0,
      taxAmount: Number(source.businessDocument?.taxAmount) || 0,
      grossAmount: Number(source.businessDocument?.grossAmount) || 0,
      lines: Array.isArray(source.businessDocument?.lines) ? source.businessDocument.lines.slice(0, 500).map((line) => ({
        lineType: ["material", "service", "other"].includes(String(line.lineType)) ? line.lineType as "material" | "service" | "other" : (String(line.sku ?? "").trim() ? "material" : "other"),
        expenseCategory: String(line.expenseCategory ?? ""),
        sku: String(line.sku ?? ""), description: String(line.description ?? ""), quantity: Number(line.quantity) || 0,
        unit: String(line.unit ?? "szt."), unitPrice: Number(line.unitPrice) || 0, netAmount: Number(line.netAmount) || 0,
        taxRate: Number(line.taxRate) || 0, grossAmount: Number(line.grossAmount) || 0,
        purchaseOrderNumber: String(line.purchaseOrderNumber ?? ""), vehicleRegistration: String(line.vehicleRegistration ?? ""),
        liters: Number(line.liters) || 0, mileage: Number(line.mileage) || 0,
        confidence: Math.max(0, Math.min(1, Number(line.confidence) || 0))
      })) : []
    },
    boqItems: Array.isArray(source.boqItems)
      ? source.boqItems.slice(0, 500).map((item) => ({
          itemNumber: String(item.itemNumber ?? ""),
          description: String(item.description ?? ""),
          quantity: Number(item.quantity) || 0,
          unit: String(item.unit ?? ""),
          unitPrice: Number(item.unitPrice) || 0,
          totalPrice: Number(item.totalPrice) || 0,
          wbsCode: String(item.wbsCode ?? "00"),
          confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0))
        }))
      : [],
    facts: Array.isArray(source.facts) ? source.facts.slice(0, 200) : [],
    warnings: Array.isArray(source.warnings) ? source.warnings.map(String) : []
  };
}

export async function analyzeDocumentWithGemini(input: AnalyzeInput) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const model = getOptionalEnv("GEMINI_MODEL") ?? "gemini-3.5-flash";
  const projectCatalog = input.projectCatalog?.length ? input.projectCatalog.join("\n") : "Brak zdefiniowanych inwestycji — użyj OGÓLNE.";
  const prompt = `Jesteś silnikiem analizy dokumentów w polskiej firmie wykonującej instalacje sanitarne, wentylację, klimatyzację i roboty budowlane.\n
Przeanalizuj dokument ${input.fileName}. Rozpoznaj jego rzeczywisty kontekst, nie tylko rozszerzenie. Kosztorys traktuj jako źródło pozycji BOQ i etapów WBS. Jeżeli to kosztorys lub przedmiar, wypełnij boqItems rzeczywistymi wierszami tabeli; nie łącz pozycji i zachowaj numer, ilość, jednostkę oraz ceny. Jeżeli dokument nie jest kosztorysem, zwróć pustą tablicę boqItems. Dla dokumentacji wskaż instalacje, etapy, wymagane wnioski materiałowe i protokoły.

Dla faktury, WZ, PZ lub dokumentu dostawy dokładnie wypełnij businessDocument: numer dokumentu, numer KSeF jeżeli faktycznie występuje, daty, strony, NIP-y, kwoty, numer zamówienia/PO jeżeli widnieje w dokumencie i każdą pozycję. Dla każdej pozycji ustaw lineType: material wyłącznie dla fizycznych materiałów/towarów/urządzeń, service dla robocizny, usług, transportu, najmu, podwykonawstwa i innych świadczeń niematerialnych, a other dla rabatów, korekt i pozycji niejednoznacznych. expenseCategory ustaw tylko gdy wynika z dokumentu: fuel dla paliwa/AdBlue, transport dla transportu/spedycji, equipment dla narzędzi/wyposażenia, subcontract dla podwykonawstwa, rental dla najmu, service dla pozostałych usług, material dla materiałów, other dla pozostałych; w razie braku pewności zwróć pusty string. Z każdej pozycji odczytaj stawkę VAT. Jeżeli dokument podaje numer PO/zamówienia przy pozycji, wpisz purchaseOrderNumber; jeśli jest tylko jeden numer dla całej faktury, wpisz go w businessDocument.purchaseOrderNumber. Dla pozycji paliwowej odczytaj vehicleRegistration, liters i mileage wyłącznie wtedy, gdy te dane są widoczne; w przeciwnym razie zwróć pusty string i 0. Nie wymyślaj numeru rejestracyjnego, PO, litrów ani przebiegu. Nie oznaczaj usługi jako materiał tylko dlatego, że ma ilość i cenę. documentType ustaw na invoice, WZ, PZ albo delivery. direction ustaw na purchase lub sale. Jeżeli dokument nie jest dokumentem handlowym/magazynowym, zwróć puste pola i pustą tablicę lines. Nie utożsamiaj zakupu materiału z wykonaniem robót. Nie próbuj wymyślać identyfikatorów bazy, BOQ, WBS ani projektu — ich twarde powiązanie wykona Octopus po analizie.

Spróbuj dopasować dokument do jednej inwestycji z katalogu poniżej. W projectHint zwróć dokładnie pełny wiersz najlepszego dopasowania albo OGÓLNE, gdy dokument dotyczy całej firmy lub brak wiarygodnych wskazówek. Nie zgaduj.
KATALOG INWESTYCJI:
${projectCatalog}

W searchPassages zwróć ważne, możliwe do wyszukania fragmenty i nagłówki dokumentu, zachowując istotne oznaczenia techniczne. Nie wymyślaj brakujących parametrów. Każdy fakt musi mieć lokalizator i krótki cytat ze źródła. Zwróć wyłącznie JSON zgodny ze schematem.`;
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (input.inlineData) parts.push({ inlineData: { mimeType: input.mimeType, data: input.inlineData } });
  if (input.fileUri) parts.push({ fileData: { mimeType: input.mimeType, fileUri: input.fileUri } });
  if (input.extractedText) parts.push({ text: `\nTREŚĆ WYEKSTRAHOWANA:\n${input.extractedText.slice(0, 1_500_000)}` });

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.1, maxOutputTokens: 8192 }
    }),
    signal: AbortSignal.timeout(55_000)
  });
  if (!response.ok) throw new Error(`Gemini odrzucił analizę: HTTP ${response.status} ${await response.text()}`.slice(0, 700));
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini nie zwrócił treści analizy.");
  return { analysis: normalizeAnalysis(JSON.parse(text)), model };
}

async function uploadGeminiFile(input: { fileName: string; mimeType: string; bytes: Buffer }) {
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
  if (!start.ok) throw new Error(`Gemini nie rozpoczął uploadu pliku: HTTP ${start.status}`);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini nie zwrócił adresu sesji uploadu.");

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
  if (!upload.ok) throw new Error(`Gemini odrzucił upload pliku: HTTP ${upload.status}`);
  const payload = await upload.json() as { file?: GeminiFile };
  if (!payload.file?.name || !payload.file.uri) throw new Error("Gemini nie zwrócił metadanych przesłanego pliku.");
  return payload.file;
}

async function waitForGeminiFile(file: GeminiFile) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  let current = file;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!current.state || current.state === "ACTIVE") return current;
    if (current.state === "FAILED") throw new Error(current.error?.message ?? "Gemini nie przetworzył pliku.");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${current.name}`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Nie udało się sprawdzić stanu pliku Gemini: HTTP ${response.status}`);
    current = await response.json() as GeminiFile;
  }
  throw new Error("Gemini zbyt długo przygotowuje plik; zadanie zostanie ponowione.");
}

async function deleteGeminiFile(name: string) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
    method: "DELETE",
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(15_000)
  }).catch(() => undefined);
}

export async function analyzeFileWithGemini(input: { fileName: string; mimeType: string; bytes: Buffer; projectCatalog?: string[] }) {
  const uploaded = await uploadGeminiFile(input);
  try {
    const activeFile = await waitForGeminiFile(uploaded);
    return await analyzeDocumentWithGemini({
      fileName: input.fileName,
      mimeType: activeFile.mimeType ?? input.mimeType,
      fileUri: activeFile.uri,
      projectCatalog: input.projectCatalog
    });
  } finally {
    await deleteGeminiFile(uploaded.name);
  }
}