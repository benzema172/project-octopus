import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { getAiRuntimeStatus } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
  if (!getAiRuntimeStatus().ready) return NextResponse.json({ error: "Gemini nie jest skonfigurowane." }, { status: 503 });
  let body: { workspaceId?: string; versionId?: string };
  try { body = await request.json() as { workspaceId?: string; versionId?: string }; } catch { return NextResponse.json({ error: "Nieprawidłowe dane analizy." }, { status: 400 }); }
  if (!body.versionId) return NextResponse.json({ error: "Brakuje identyfikatora wersji." }, { status: 400 });
  const workspace = body.workspaceId ? await getWorkspaceForUser(user, body.workspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });
  try {
    const analysis = await processDocumentVersion({ workspaceId: workspace.id, versionId: body.versionId, userId: user.id });
    return NextResponse.json({ ok: true, analysis }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analiza nie powiodła się.", queued: true }, { status: 422 });
  }
}
