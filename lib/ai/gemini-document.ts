import "server-only";

import { getOptionalEnv, requireServerEnv } from "@/lib/env";
import { DOCUMENT_DESTINATIONS, type DocumentCategory } from "@/lib/documents/classification";

export type AnalysisSource = {
  page_number: number | null;
  quote: string;
};

export type GeminiDocumentAnalysis = {
  category: DocumentCategory;
  confidence: number;
  summary: string;
  extracted_text: string;
  facts: Array<AnalysisSource & { fact_type: string; value_text: string; confidence: number }>;
  materials: Array<AnalysisSource & { name: string; installation: string; specification: string }>;
  devices: Array<AnalysisSource & { name: string; installation: string; parameters: Array<{ key: string; value: string }> }>;
  boq_items: Array<AnalysisSource & {
    item_number: string;
    description: string;
    quantity: number | null;
    unit: string;
    unit_price: number | null;
    total_price: number | null;
  }>;
  findings: Array<AnalysisSource & { severity: "info" | "warning" | "critical"; title: string; description: string }>;
};

type GeminiUploadedFile = {
  name: string;
  uri: string;
  mimeType: string;
};

const CATEGORY_ENUM = DOCUMENT_DESTINATIONS.map((item) => item.value);

const analysisSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORY_ENUM },
    confidence: { type: "number" },
    summary: { type: "string" },
    extracted_text: { type: "string" },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fact_type: { type: "string" },
          value_text: { type: "string" },
          confidence: { type: "number" },
          page_number: { type: ["integer", "null"] },
          quote: { type: "string" }
        },
        required: ["fact_type", "value_text", "confidence", "page_number", "quote"]
      }
    },
    materials: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          installation: { type: "string" },
          specification: { type: "string" },
          page_number: { type: ["integer", "null"] },
          quote: { type: "string" }
        },
        required: ["name", "installation", "specification", "page_number", "quote"]
      }
    },
    devices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          installation: { type: "string" },
          parameters: {
            type: "array",
            items: {
              type: "object",
              properties: { key: { type: "string" }, value: { type: "string" } },
              required: ["key", "value"]
            }
          },
          page_number: { type: ["integer", "null"] },
          quote: { type: "string" }
        },
        required: ["name", "installation", "parameters", "page_number", "quote"]
      }
    },
    boq_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_number: { type: "string" },
          description: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: "string" },
          unit_price: { type: ["number", "null"] },
          total_price: { type: ["number", "null"] },
          page_number: { type: ["integer", "null"] },
          quote: { type: "string" }
        },
        required: ["item_number", "description", "quantity", "unit", "unit_price", "total_price", "page_number", "quote"]
      }
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          title: { type: "string" },
          description: { type: "string" },
          page_number: { type: ["integer", "null"] },
          quote: { type: "string" }
        },
        required: ["severity", "title", "description", "page_number", "quote"]
      }
    }
  },
  required: ["category", "confidence", "summary", "extracted_text", "facts", "materials", "devices", "boq_items", "findings"]
};

function promptForDocument(fileName: string, existingCategory: string | null, includeTranscription: boolean) {
  return `Jesteś silnikiem analizy dokumentów Project Octopus dla inwestycji budowlanych.\n\nPLIK: ${fileName}\nWSTĘPNA KATEGORIA Z WRZUTNI: ${existingCategory ?? "brak"}\n\nWykonaj jednocześnie:\n1. Rozpoznaj rzeczywistą kategorię dokumentu spośród: ${CATEGORY_ENUM.join(", ")}.\n2. Wyciągnij najważniejsze fakty przydatne w prowadzeniu inwestycji: strony umowy, terminy, wartość, zakres, lokalizację, wymagania techniczne, instalacje, wymagane próby i odbiory.\n3. Rozpoznaj materiały i urządzenia wraz z instalacją i parametrami.\n4. Jeżeli dokument zawiera kosztorys/przedmiar, wyciągnij pozycje BOQ.\n5. Wskaż braki, ryzyka, sprzeczności lub wymagania wymagające uwagi.\n6. Każda informacja źródłowa ma mieć możliwie krótki cytat i numer strony, jeżeli da się go wiarygodnie ustalić. Nie wymyślaj numeru strony.\n7. Nie zgaduj danych. Gdy czegoś nie ma, pomiń to.\n8. Confidence zwracaj w skali 0..1.\n${includeTranscription ? "9. W polu extracted_text zwróć możliwie pełną transkrypcję tekstu dokumentu (maksymalnie około 60 000 znaków), zachowując nagłówki i strukturę. To pole służy do późniejszego chunkowania w Brain." : "9. Pole extracted_text pozostaw puste, ponieważ tekst został już wyciągnięty lokalnie."}\n\nTo jest dokument inwestycji budowlanej. Priorytetem są fakty i źródła, nie ogólne streszczenia.`;
}

function normalizeAnalysis(value: unknown): GeminiDocumentAnalysis {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const category = CATEGORY_ENUM.includes(String(raw.category)) ? String(raw.category) as DocumentCategory : "do_weryfikacji";
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const array = (key: string) => Array.isArray(raw[key]) ? raw[key] as Array<Record<string, unknown>> : [];
  const source = (item: Record<string, unknown>): AnalysisSource => ({
    page_number: Number.isFinite(Number(item.page_number)) ? Number(item.page_number) : null,
    quote: String(item.quote ?? "").slice(0, 700)
  });

  return {
    category,
    confidence,
    summary: String(raw.summary ?? "").slice(0, 6_000),
    extracted_text: String(raw.extracted_text ?? "").slice(0, 80_000),
    facts: array("facts").slice(0, 120).map((item) => ({ ...source(item), fact_type: String(item.fact_type ?? "informacja").slice(0, 120), value_text: String(item.value_text ?? "").slice(0, 4_000), confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)) })),
    materials: array("materials").slice(0, 120).map((item) => ({ ...source(item), name: String(item.name ?? "").slice(0, 300), installation: String(item.installation ?? "").slice(0, 300), specification: String(item.specification ?? "").slice(0, 2_000) })),
    devices: array("devices").slice(0, 100).map((item) => ({
      ...source(item),
      name: String(item.name ?? "").slice(0, 300),
      installation: String(item.installation ?? "").slice(0, 300),
      parameters: (Array.isArray(item.parameters) ? item.parameters : []).slice(0, 30).map((parameter) => {
        const row = parameter && typeof parameter === "object" ? parameter as Record<string, unknown> : {};
        return { key: String(row.key ?? "").slice(0, 160), value: String(row.value ?? "").slice(0, 500) };
      })
    })),
    boq_items: array("boq_items").slice(0, 300).map((item) => ({
      ...source(item),
      item_number: String(item.item_number ?? "").slice(0, 100),
      description: String(item.description ?? "").slice(0, 2_000),
      quantity: item.quantity === null || item.quantity === undefined ? null : Number(item.quantity),
      unit: String(item.unit ?? "").slice(0, 80),
      unit_price: item.unit_price === null || item.unit_price === undefined ? null : Number(item.unit_price),
      total_price: item.total_price === null || item.total_price === undefined ? null : Number(item.total_price)
    })),
    findings: array("findings").slice(0, 80).map((item) => ({
      ...source(item),
      severity: ["warning", "critical"].includes(String(item.severity)) ? String(item.severity) as "warning" | "critical" : "info",
      title: String(item.title ?? "").slice(0, 300),
      description: String(item.description ?? "").slice(0, 2_000)
    }))
  };
}

async function uploadGeminiFile(buffer: Buffer, fileName: string, mimeType: string, apiKey: string): Promise<GeminiUploadedFile> {
  const startResponse = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: fileName.slice(0, 500) } })
  });

  if (!startResponse.ok) throw new Error(`Gemini nie przygotował uploadu PDF: HTTP ${startResponse.status}`);
  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini nie zwrócił adresu uploadu pliku.");

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(buffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: buffer
  });

  if (!uploadResponse.ok) throw new Error(`Gemini odrzucił plik PDF: HTTP ${uploadResponse.status}`);
  const payload = await uploadResponse.json() as { file?: { name?: string; uri?: string; mimeType?: string; mime_type?: string } };
  const file = payload.file;
  if (!file?.name || !file.uri) throw new Error("Gemini nie zwrócił identyfikatora przetworzonego pliku.");
  return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? file.mime_type ?? mimeType };
}

async function deleteGeminiFile(name: string, apiKey: string) {
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
    method: "DELETE",
    headers: { "x-goog-api-key": apiKey }
  }).catch(() => undefined);
}

async function generateStructuredAnalysis(parts: Array<Record<string, unknown>>, apiKey: string) {
  const model = getOptionalEnv("GEMINI_MODEL") ?? "gemini-2.5-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseFormat: { text: { mimeType: "application/json", schema: analysisSchema } }
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini analysis failed: HTTP ${response.status}${detail ? ` · ${detail.slice(0, 500)}` : ""}`);
  }

  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini nie zwrócił analizy dokumentu.");
  return normalizeAnalysis(JSON.parse(text));
}

export async function analyzeDocumentWithGemini(input: {
  fileName: string;
  mimeType: string;
  existingCategory: string | null;
  extractedText: string | null;
  pdfBuffer: Buffer | null;
}) {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const prompt = promptForDocument(input.fileName, input.existingCategory, Boolean(input.pdfBuffer));

  if (input.pdfBuffer) {
    const uploaded = await uploadGeminiFile(input.pdfBuffer, input.fileName, "application/pdf", apiKey);
    try {
      return await generateStructuredAnalysis([
        { text: prompt },
        { file_data: { mime_type: uploaded.mimeType, file_uri: uploaded.uri } }
      ], apiKey);
    } finally {
      await deleteGeminiFile(uploaded.name, apiKey);
    }
  }

  return generateStructuredAnalysis([
    { text: `${prompt}\n\n--- WYEKSTRAHOWANA TREŚĆ ---\n${input.extractedText ?? ""}` }
  ], apiKey);
}
