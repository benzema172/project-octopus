import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { processDocumentVersion } from "@/lib/ai/document-pipeline";
import { getProjectForUser } from "@/lib/data/projects";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  projectId?: string;
  documentId?: string;
  versionId?: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Brak aktywnej sesji.", 401);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return jsonError("Nieprawidłowe dane pipeline AI.", 400);
  }

  const projectId = body.projectId?.trim();
  const documentId = body.documentId?.trim();
  const versionId = body.versionId?.trim();

  if (!projectId || !documentId || !versionId) {
    return jsonError("Brakuje identyfikatora inwestycji, dokumentu albo wersji.", 400);
  }

  const project = await getProjectForUser(user, projectId);
  if (!project) return jsonError("Nie znaleziono inwestycji lub nie masz do niej dostępu.", 404);

  try {
    const result = await processDocumentVersion({ projectId, documentId, versionId, userId: user.id });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline AI nie zakończył analizy dokumentu.";
    const status = /limit Gemini/i.test(message) ? 429 : /przekracza|18 MB|64 MB/i.test(message) ? 413 : 500;
    return jsonError(message, status);
  }
}
