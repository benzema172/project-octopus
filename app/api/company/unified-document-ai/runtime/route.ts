import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const BACKGROUND_TOKEN_HEADER = "x-octopus-background-token";

export async function POST(request: Request) {
  const db = createServiceSupabaseClient();
  const backgroundToken = request.headers.get(BACKGROUND_TOKEN_HEADER)?.trim();
  if (!backgroundToken) return NextResponse.json({ error: "Brak autoryzacji diagnostyki AI." }, { status: 401 });

  const { data: authorized, error: authError } = await db.rpc("verify_background_worker_token", { p_token: backgroundToken });
  if (authError || authorized !== true) return NextResponse.json({ error: "Nieprawidłowa autoryzacja diagnostyki AI." }, { status: 403 });

  const key = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
  if (!key) {
    return NextResponse.json({ ok: false, configured: false, model, reason: "missing_api_key" }, { status: 503 });
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Zwróć wyłącznie JSON: {\"ok\":true}." }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 32, responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(18000)
    });
    const payload = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { status?: string; message?: string } } | null;
    const candidatePresent = Boolean(payload?.candidates?.[0]?.content?.parts?.some((part) => Boolean(part.text?.trim())));
    return NextResponse.json({
      ok: response.ok && candidatePresent,
      configured: true,
      model,
      geminiHttpStatus: response.status,
      candidatePresent,
      providerErrorStatus: payload?.error?.status ?? null,
      providerMessage: response.ok ? null : String(payload?.error?.message ?? "Gemini request failed").slice(0, 300)
    }, { status: response.ok && candidatePresent ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      configured: true,
      model,
      geminiHttpStatus: null,
      candidatePresent: false,
      reason: error instanceof Error ? error.name : "runtime_error"
    }, { status: 502 });
  }
}
