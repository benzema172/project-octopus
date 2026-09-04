import "server-only";

import { createHash } from "node:crypto";
import { getOptionalEnv } from "@/lib/env";

export type FleetAiContext = {
  workspaceId: string;
  vehicles: Array<Record<string, unknown>>;
  readiness: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  predictions: Array<Record<string, unknown>>;
  assetDecisions: Array<Record<string, unknown>>;
  driverScores: Array<Record<string, unknown>>;
  workshopScores: Array<Record<string, unknown>>;
  regulatory: Array<Record<string, unknown>>;
  missions: Array<Record<string, unknown>>;
};

export type FleetGeminiRecommendation = {
  dedupeKey: string;
  vehicleId?: string;
  projectId?: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  confidence: number;
  recommendedAction: string;
  estimatedSaving?: number;
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    recommendations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          dedupeKey: { type: "STRING" }, vehicleId: { type: "STRING" }, projectId: { type: "STRING" }, title: { type: "STRING" }, description: { type: "STRING" },
          severity: { type: "STRING", enum: ["info","warning","critical"] }, confidence: { type: "NUMBER" }, recommendedAction: { type: "STRING" }, estimatedSaving: { type: "NUMBER" }
        },
        required: ["dedupeKey","vehicleId","projectId","title","description","severity","confidence","recommendedAction","estimatedSaving"]
      }
    }
  },
  required: ["recommendations"]
};

function compact(value: unknown, max = 120_000) {
  const json = JSON.stringify(value);
  return json.length <= max ? json : json.slice(0, max);
}

function clamp(value: unknown) { return Math.max(0, Math.min(1, Number(value) || 0)); }

export async function enrichFleetControllerWithGemini(context: FleetAiContext): Promise<FleetGeminiRecommendation[]> {
  const apiKey = getOptionalEnv("GEMINI_API_KEY");
  if (!apiKey) return [];
  const model = getOptionalEnv("GEMINI_MODEL") ?? "gemini-3.5-flash";
  const prompt = `Jesteś kontrolerem operacyjnym floty w polskiej firmie. Pracujesz WYŁĄCZNIE na przekazanych danych Project Octopus. Nie wymyślaj usterek, cen, lokalizacji, przepisów ani oszczędności. Jeśli danych jest za mało — napisz to w rekomendacji albo nie twórz rekomendacji.\n\nTwoim zadaniem jest znaleźć maksymalnie 8 realnych, niepowtarzalnych działań, które firma powinna wykonać. Priorytety: bezpieczeństwo i legalność, ciągłość pracy, koszt/TCO, gwarancje, wykorzystanie aktywów, planowane misje, paliwo, serwis, EV. Nie powtarzaj literalnie istniejącej regułowej rekomendacji — dodaj wartość przez połączenie kilku sygnałów. estimatedSaving podawaj tylko wtedy, gdy da się go policzyć bez zgadywania; w przeciwnym razie 0. vehicleId/projectId muszą pochodzić z danych albo być pustym stringiem. dedupeKey ma być krótki, stabilny i zaczynać się od gemini:.\n\nDANE:\n${compact(context)}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.12, maxOutputTokens: 8192 } }),
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`Gemini Fleet Controller: HTTP ${response.status}`);
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  const parsed = JSON.parse(raw || "{}") as { recommendations?: Array<Record<string, unknown>> };
  return (parsed.recommendations ?? []).slice(0, 8).map((item) => ({
    dedupeKey: String(item.dedupeKey || `gemini:${createHash("sha1").update(String(item.title ?? "fleet")).digest("hex").slice(0,12)}`),
    vehicleId: String(item.vehicleId ?? "") || undefined,
    projectId: String(item.projectId ?? "") || undefined,
    title: String(item.title ?? "Rekomendacja Fleet AI").slice(0, 180),
    description: String(item.description ?? "").slice(0, 3000),
    severity: ["info","warning","critical"].includes(String(item.severity)) ? item.severity as "info"|"warning"|"critical" : "info",
    confidence: clamp(item.confidence),
    recommendedAction: String(item.recommendedAction ?? "review").slice(0,120),
    estimatedSaving: Math.max(0, Number(item.estimatedSaving) || 0)
  })).filter((item) => item.description && item.confidence >= 0.5);
}
