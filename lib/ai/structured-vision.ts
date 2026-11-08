import "server-only";
import { getOptionalEnv, requireServerEnv } from "../env";

/** Small, bounded diagnostic calls; they never execute document instructions. */
export async function structuredVision(prompt: string, parts: Array<Record<string, unknown>>, schema: Record<string, unknown>) {
  const model = getOptionalEnv("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": requireServerEnv("GEMINI_API_KEY") },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, ...parts] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0, maxOutputTokens: 8192 } }),
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Odczyt kontrolny Gemini: HTTP ${response.status}.`); }
  const result = await response.json() as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }> };
  const candidate = result.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") throw new Error("Niekompletny odczyt kontrolny Gemini.");
  return JSON.parse(candidate?.content?.parts?.map(part => part.text ?? "").join("") ?? "") as unknown;
}
