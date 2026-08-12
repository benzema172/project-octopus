import "server-only";

import { getOptionalEnv, requireServerEnv } from "@/lib/env";
import type { DocumentCategory } from "@/lib/documents/classification";
import type { ExtractedDocument, ExtractedPage } from "@/lib/documents/extraction";

const DOCUMENT_MODEL = () => getOptionalEnv("GEMINI_DOCUMENT_MODEL") ?? getOptionalEnv("GEMINI_MODEL") ?? "gemini-2.5-flash-lite";
const GEMINI_ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const MAX_INLINE_PDF_BYTES = 18 * 1024 * 1024;

export type AiFact = {
  fact_type: string;
  value_text: string;
  confidence: number;
  page_number: number;
  quote: string;
};

export type AiMaterial = {
  name: string;
  installation: string;
  specification: string;
  confidence: number;
  page_number: number;
  quote: string;
};

export type AiDevice = {
  name: string;
  installation: string;
  parameters: Record<string, string>;
  confidence: number;
  page_number: number;
  quote: string;
};

export type AiBoqItem = {
  item_number: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total_price: string;
  confidence: number;
  page_number: number;
  quote: string;
};

export type AiFinding = {
  finding_type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  page_number: number;
  quote: string;
};

export type DocumentAiAnalysis = {
  suggested_category: DocumentCategory;
  confidence: number;
  summary: string;
  facts: AiFact[];
  materials: AiMaterial[];
  devices: AiDevice[];
  boq_items: AiBoqItem[];
  findings: AiFinding[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  error?: { message?: string };
};

function responseText(payload: GeminiResponse) {
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

async function generateJson<T>({
  parts,
  schema,
  maxOutputTokens = 16_000,
  timeoutMs = 55_000
}: {
  parts: Array<Record<string, unknown>>;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<{ data: T; model: string }> {
  const apiKey = requireServerEnv("GEMINI_API_KEY");
  const model = DOCUMENT_MODEL();
  const response = await fetch(GEMINI_ENDPOINT(model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        maxOutputTokens,
        temperature: 0.1
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const payload = (await response.json().catch(() => ({}))) as GeminiResponse;

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Darmowy limit Gemini został chwilowo wykorzystany. Analizę można ponowić później.");
    }
    throw new Error(payload.error?.message ?? `Gemini API zwróciło HTTP ${response.status}.`);
  }

  if (payload.promptFeedback?.blockReason) {
    throw new Error(payload.promptFeedback.blockReasonMessage ?? `Gemini zablokowało dokument: ${payload.promptFeedback.blockReason}.`);
  }

  const text = responseText(payload);
  if (!text) throw new Error("Gemini nie zwróciło danych dla dokumentu.");

  try {
    return { data: JSON.parse(text) as T, model };
  } catch {
    throw new Error("Gemini zwróciło nieprawidłowy JSON podczas analizy dokumentu.");
  }
}

const PDF_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page_number: { type: "integer" },
          label: { type: "string" },
          text: { type: "string" }
        },
        required: ["page_number", "label", "text"]
      }
    },
    truncated: { type: "boolean" }
  },
  required: ["pages", "truncated"]
};

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    suggested_category: {
      type: "string",
      enum: ["dokumentacja", "kosztorys", "harmonogram", "protokol", "wniosek", "umowa", "korespondencja", "do_weryfikacji"]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string" },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fact_type: { type: "string" },
          value_text: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          page_number: { type: "integer" },
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
          confidence: { type: "number", minimum: 0, maximum: 1 },
          page_number: { type: "integer" },
          quote: { type: "string" }
        },
        required: ["name", "installation", "specification", "confidence", "page_number", "quote"]
      }
    },
    devices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          installation: { type: "string" },
          parameters: { type: "object", additionalProperties: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          page_number: { type: "integer" },
          quote: { type: "string" }
        },
        required: ["name", "installation", "parameters", "confidence", "page_number", "quote"]
      }
    },
    boq_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_number: { type: "string" },
          description: { type: "string" },
          quantity: { type: "string" },
          unit: { type: "string" },
          unit_price: { type: "string" },
          total_price: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          page_number: { type: "integer" },
          quote: { type: "string" }
        },
        required: ["item_number", "description", "quantity", "unit", "unit_price", "total_price", "confidence", "page_number", "quote"]
      }
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding_type: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          title: { type: "string" },
          description: { type: "string" },
          page_number: { type: "integer" },
          quote: { type: "string" }
        },
        required: ["finding_type", "severity", "title", "description", "page_number", "quote"]
      }
    }
  },
  required: ["suggested_category", "confidence", "summary", "facts", "materials", "devices", "boq_items", "findings"]
};

export async function extractPdfWithGemini(buffer: Buffer, fileName: string): Promise<{ extracted: ExtractedDocument; model: string }> {
  if (buffer.length > MAX_INLINE_PDF_BYTES) {
    throw new Error("PDF przekracza 18 MB dla natychmiastowej analizy. Plik został zapisany; duże PDF-y będą wymagały trybu wsadowego/File API.");
  }

  const prompt = [
    `Plik: ${fileName}`,
    "Jesteś ekstraktorem dokumentacji budowlanej. Odczytaj PDF strona po stronie.",
    "Zwróć najważniejszy tekst źródłowy z każdej strony, zachowując nazwy urządzeń, materiały, parametry, liczby, jednostki, numery pozycji, daty, nazwy stron i wymagania techniczne.",
    "Nie interpretuj jeszcze dokumentu i nie dopisuj informacji. To jest etap ekstrakcji.",
    "Dla każdej strony zwróć maksymalnie ok. 2500 znaków tekstu istotnego dla późniejszej analizy. Jeśli dokument jest bardzo długi i nie mieści się w odpowiedzi, ustaw truncated=true."
  ].join("\n\n");

  const { data, model } = await generateJson<{ pages: Array<{ page_number: number; label: string; text: string }>; truncated: boolean }>({
    parts: [
      { text: prompt },
      { inline_data: { mime_type: "application/pdf", data: buffer.toString("base64") } }
    ],
    schema: PDF_EXTRACTION_SCHEMA,
    maxOutputTokens: 32_000,
    timeoutMs: 58_000
  });

  const pages: ExtractedPage[] = (data.pages ?? [])
    .filter((page) => Number.isFinite(page.page_number) && page.text?.trim())
    .map((page) => ({ pageNumber: page.page_number, label: page.label || `Strona ${page.page_number}`, text: page.text.trim() }));

  if (!pages.length) throw new Error("Gemini nie wydobyło tekstu z PDF.");

  return {
    extracted: {
      method: "gemini-pdf",
      pages,
      text: pages.map((page) => `[STRONA ${page.pageNumber} | ${page.label}]\n${page.text}`).join("\n\n"),
      truncated: Boolean(data.truncated)
    },
    model
  };
}

export async function analyzeExtractedDocument({
  fileName,
  currentCategory,
  extracted
}: {
  fileName: string;
  currentCategory: string | null;
  extracted: ExtractedDocument;
}): Promise<{ analysis: DocumentAiAnalysis; model: string }> {
  const sourceText = extracted.pages
    .map((page) => `[ŹRÓDŁO ${page.pageNumber} | ${page.label}]\n${page.text}`)
    .join("\n\n")
    .slice(0, 500_000);

  const instructions = [
    "Jesteś Octopus Brain. Analizujesz dokument z inwestycji budowlanej po etapie ekstrakcji.",
    `Nazwa pliku: ${fileName}`,
    `Kategoria wybrana przed analizą: ${currentCategory || "brak"}`,
    "Najpierw sklasyfikuj dokument do jednej kategorii: dokumentacja, kosztorys, harmonogram, protokol, wniosek, umowa, korespondencja, do_weryfikacji.",
    "Wyciągaj tylko informacje wynikające ze źródła. Nie zgaduj producentów, parametrów, ilości ani wartości.",
    "facts: istotne fakty kontraktowe i techniczne, np. inwestor, lokalizacja, numer kontraktu, terminy, zakres, instalacje, wymagane próby, parametry.",
    "materials: materiały wymienione w dokumencie; devices: urządzenia; boq_items: pozycje kosztorysowe/przedmiarowe, jeśli występują.",
    "findings: braki, sprzeczności, wymagane działania, ryzyka lub ważne uwagi. Nie twórz alarmów bez podstawy w źródle.",
    "Dla każdego elementu podaj numer strony/arkusza i krótki cytat źródłowy. Cytat ma być możliwie krótki i dosłowny (maks. 300 znaków).",
    "Jeżeli dokument nie zawiera danego rodzaju informacji, zwróć pustą tablicę.",
    extracted.truncated ? "UWAGA: ekstrakcja została skrócona — obniż pewność wniosków zależnych od pełnego dokumentu." : "Ekstrakcja nie została oznaczona jako skrócona.",
    "TREŚĆ ŹRÓDŁOWA:",
    sourceText
  ].join("\n\n");

  const { data, model } = await generateJson<DocumentAiAnalysis>({
    parts: [{ text: instructions }],
    schema: ANALYSIS_SCHEMA,
    maxOutputTokens: 16_000,
    timeoutMs: 58_000
  });

  return { analysis: data, model };
}
