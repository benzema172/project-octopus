import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { processDocumentVersion } from "@/lib/ai/process-document";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";

export const runtime = "nodejs";
export const maxDuration = 300;

type VersionRow = {
  document_id: string;
  project_id: string | null;
};

type DocumentRow = {
  category: string | null;
};

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: { workspaceId?: string; versionId?: string };
  try {
    body = await request.json() as { workspaceId?: string; versionId?: string };
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane analizy." }, { status: 400 });
  }

  if (!body.versionId) {
    return NextResponse.json({ error: "Brakuje identyfikatora wersji." }, { status: 400 });
  }

  const workspace = body.workspaceId
    ? await getWorkspaceForUser(user, body.workspaceId)
    : await ensureWorkspaceForUser(user);
  if (!workspace) return NextResponse.json({ error: "Brak dostępu do firmy." }, { status: 403 });

  const supabase = createServiceSupabaseClient();
  const { data: version, error: versionError } = await supabase
    .from("document_versions")
    .select("document_id,project_id")
    .eq("id", body.versionId)
    .maybeSingle<VersionRow>();

  if (versionError) {
    console.error("[brain/process] version lookup failed", versionError);
    return NextResponse.json({ error: "Nie udało się odczytać wersji dokumentu." }, { status: 500 });
  }

  if (!version) {
    return NextResponse.json({ error: "Nie znaleziono wersji dokumentu." }, { status: 404 });
  }

  const { data: sourceDocument, error: documentError } = await supabase
    .from("documents")
    .select("category")
    .eq("id", version.document_id)
    .eq("workspace_id", workspace.id)
    .maybeSingle<DocumentRow>();

  if (documentError) {
    console.error("[brain/process] document lookup failed", documentError);
    return NextResponse.json({ error: "Nie udało się zweryfikować dokumentu w aktywnej firmie." }, { status: 500 });
  }

  if (!sourceDocument) {
    return NextResponse.json({ error: "Nie znaleziono wersji dokumentu w aktywnej firmie." }, { status: 404 });
  }

  if (!await hasDomainAccess({
    workspaceId: workspace.id,
    userId: user.id,
    domain: domainForDocumentCategory(sourceDocument.category),
    level: "write",
    projectId: version.project_id,
  })) {
    return NextResponse.json({ error: "Brak uprawnienia do uruchomienia analizy tego dokumentu." }, { status: 403 });
  }

  try {
    const analysis = await processDocumentVersion({
      workspaceId: workspace.id,
      versionId: body.versionId,
      userId: user.id,
    });
    return NextResponse.json({ ok: true, analysis }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analiza nie powiodła się.", queued: true },
      { status: 422 },
    );
  }
}
