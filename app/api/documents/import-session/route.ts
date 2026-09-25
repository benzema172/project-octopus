import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getProjectForUser } from "@/lib/data/projects";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { normalizeDocumentSourceModule } from "@/lib/documents/source-module";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ImportFile = {
  relativePath?: string;
  fileName?: string;
  fileSize?: number;
};

type ImportSessionBody = {
  action?: "create" | "finalize" | "fail";
  workspaceId?: string;
  projectId?: string | null;
  sessionId?: string;
  itemId?: string;
  sourceModule?: string;
  label?: string;
  error?: string;
  files?: ImportFile[];
};

type SessionRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  label: string | null;
  source_module: string | null;
  status: "uploading" | "processing" | "complete" | "review" | "error";
  expected_files: number;
  created_by: string | null;
  upload_completed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SessionItemRow = {
  id: string;
  session_id: string;
  workspace_id: string;
  ordinal: number;
  relative_path: string;
  file_name: string;
  file_size_bytes: number;
  document_id: string | null;
  document_version_id: string | null;
  upload_status: "pending" | "uploaded" | "failed";
  error_message: string | null;
};

type DocumentRow = {
  id: string;
  category: string | null;
  ai_status: string | null;
  ai_confidence: number | null;
  current_version_id: string | null;
  project_id: string | null;
};

type ClassificationRow = {
  document_id: string;
  document_version_id: string;
  category: string;
  confidence: number | null;
  status: string;
  created_at: string;
};

type ReviewActionRow = {
  document_id: string | null;
  note: string | null;
  next_status: string | null;
  created_at: string;
};

type ExtractionRow = {
  document_id: string;
  document_version_id: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function cleanPath(value: unknown, fallback: string) {
  return String(value ?? fallback).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/").slice(0, 900);
}

function increment(target: Record<string, number>, key: string) {
  const normalized = key.trim() || "nierozpoznany";
  target[normalized] = (target[normalized] ?? 0) + 1;
}

function businessDocumentTypes(payload: Record<string, unknown> | null) {
  if (!payload) return [] as string[];
  const documents = Array.isArray(payload.businessDocuments)
    ? payload.businessDocuments
    : payload.businessDocument && typeof payload.businessDocument === "object" && !Array.isArray(payload.businessDocument)
      ? [payload.businessDocument]
      : [];
  return documents.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const type = String((value as Record<string, unknown>).documentType ?? "").trim();
    return type ? [type] : [];
  });
}

async function resolveWorkspace(user: { id: string }, workspaceId?: string) {
  return workspaceId?.trim()
    ? getWorkspaceForUser(user, workspaceId.trim())
    : ensureWorkspaceForUser(user);
}

async function sessionForUser(workspaceId: string, sessionId: string, userId: string) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db.from("document_import_sessions")
    .select("id,workspace_id,project_id,label,source_module,status,expected_files,created_by,upload_completed_at,completed_at,created_at,updated_at")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .eq("created_by", userId)
    .maybeSingle<SessionRow>();
  if (error) throw new Error(`Nie udało się odczytać sesji importu: ${error.message}`);
  return data;
}

async function buildSummary(session: SessionRow) {
  const db = createServiceSupabaseClient();
  const { data: items, error: itemsError } = await db.from("document_import_session_items")
    .select("id,session_id,workspace_id,ordinal,relative_path,file_name,file_size_bytes,document_id,document_version_id,upload_status,error_message")
    .eq("session_id", session.id)
    .eq("workspace_id", session.workspace_id)
    .order("ordinal", { ascending: true })
    .returns<SessionItemRow[]>();
  if (itemsError) throw new Error(`Nie udało się odczytać plików sesji: ${itemsError.message}`);

  const documentIds = Array.from(new Set((items ?? []).map((item) => item.document_id).filter((id): id is string => Boolean(id))));
  const documentsResult = documentIds.length
    ? await db.from("documents").select("id,category,ai_status,ai_confidence,current_version_id,project_id")
      .eq("workspace_id", session.workspace_id).in("id", documentIds).returns<DocumentRow[]>()
    : { data: [] as DocumentRow[], error: null };
  if (documentsResult.error) throw new Error(`Nie udało się odczytać wyników dokumentów: ${documentsResult.error.message}`);
  const documents = new Map((documentsResult.data ?? []).map((document) => [document.id, document]));

  const versionIds = Array.from(new Set((items ?? []).map((item) => item.document_version_id).filter((id): id is string => Boolean(id))));
  const [classificationsResult, extractionsResult, reviewActionsResult] = await Promise.all([
    versionIds.length
      ? db.from("document_classifications")
        .select("document_id,document_version_id,category,confidence,status,created_at")
        .eq("workspace_id", session.workspace_id)
        .in("document_version_id", versionIds)
        .order("created_at", { ascending: false })
        .returns<ClassificationRow[]>()
      : Promise.resolve({ data: [] as ClassificationRow[], error: null }),
    versionIds.length
      ? db.from("document_extractions")
        .select("document_id,document_version_id,payload,created_at")
        .eq("workspace_id", session.workspace_id)
        .eq("extraction_type", "document_context")
        .in("document_version_id", versionIds)
        .order("created_at", { ascending: false })
        .returns<ExtractionRow[]>()
      : Promise.resolve({ data: [] as ExtractionRow[], error: null }),
    documentIds.length
      ? db.from("ai_review_actions")
        .select("document_id,note,next_status,created_at")
        .eq("workspace_id", session.workspace_id)
        .eq("entity_type", "document")
        .in("document_id", documentIds)
        .order("created_at", { ascending: false })
        .returns<ReviewActionRow[]>()
      : Promise.resolve({ data: [] as ReviewActionRow[], error: null })
  ]);
  if (classificationsResult.error) throw new Error(`Nie udało się odczytać klasyfikacji sesji: ${classificationsResult.error.message}`);
  if (extractionsResult.error) throw new Error(`Nie udało się odczytać analiz sesji: ${extractionsResult.error.message}`);
  if (reviewActionsResult.error) console.error("Project Octopus: Batch Import review actions fallback", reviewActionsResult.error);

  const classificationByVersion = new Map<string, ClassificationRow>();
  for (const row of classificationsResult.data ?? []) if (!classificationByVersion.has(row.document_version_id)) classificationByVersion.set(row.document_version_id, row);
  const extractionByVersion = new Map<string, ExtractionRow>();
  for (const row of extractionsResult.data ?? []) if (!extractionByVersion.has(row.document_version_id)) extractionByVersion.set(row.document_version_id, row);
  const latestActionByDocument = new Map<string, ReviewActionRow>();
  for (const row of reviewActionsResult.data ?? []) {
    if (row.document_id && !latestActionByDocument.has(row.document_id)) latestActionByDocument.set(row.document_id, row);
  }

  const counts = { total: items?.length ?? 0, uploaded: 0, ready: 0, automatic: 0, review: 0, processing: 0, error: 0 };
  const documentTypes: Record<string, number> = {};
  const categories: Record<string, number> = {};
  const rows = (items ?? []).map((item) => {
    const document = item.document_id ? documents.get(item.document_id) : undefined;
    const versionId = item.document_version_id ?? document?.current_version_id ?? null;
    const classification = versionId ? classificationByVersion.get(versionId) : undefined;
    const extraction = versionId ? extractionByVersion.get(versionId) : undefined;
    const category = classification?.category ?? document?.category ?? null;
    const types = businessDocumentTypes(extraction?.payload ?? null);
    if (types.length) types.forEach((type) => increment(documentTypes, type));
    else if (category) increment(categories, category);

    let state: "pending" | "processing" | "ready" | "review" | "error";
    if (item.upload_status === "failed") state = "error";
    else if (item.upload_status === "pending") state = "pending";
    else if (["error", "failed"].includes(document?.ai_status ?? "")) state = "error";
    else if (["review", "rejected"].includes(document?.ai_status ?? "") || classification?.status === "proposed") state = "review";
    else if (document?.ai_status === "ready" || classification?.status === "approved") state = "ready";
    else state = "processing";

    const latestAction = item.document_id ? latestActionByDocument.get(item.document_id) : undefined;
    const automatic = state === "ready" && Boolean(latestAction?.note?.startsWith("Autopilot AI:"));

    if (item.upload_status === "uploaded") counts.uploaded += 1;
    if (state === "ready") {
      counts.ready += 1;
      if (automatic) counts.automatic += 1;
    } else if (state === "review") counts.review += 1;
    else if (state === "error") counts.error += 1;
    else counts.processing += 1;

    return {
      id: item.id,
      ordinal: item.ordinal,
      relativePath: item.relative_path,
      fileName: item.file_name,
      documentId: item.document_id,
      versionId,
      category,
      confidence: classification?.confidence ?? document?.ai_confidence ?? null,
      types,
      state,
      automatic,
      error: item.error_message
    };
  });

  const terminal = counts.processing === 0 && counts.total > 0;
  const nextStatus: SessionRow["status"] = !terminal
    ? "processing"
    : counts.error > 0 ? "error"
      : counts.review > 0 ? "review"
        : "complete";
  if (session.status !== nextStatus || (terminal && !session.completed_at)) {
    await db.from("document_import_sessions").update({
      status: nextStatus,
      completed_at: terminal ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq("id", session.id).eq("workspace_id", session.workspace_id);
  }

  return {
    id: session.id,
    label: session.label,
    projectId: session.project_id,
    sourceModule: session.source_module,
    status: nextStatus,
    expectedFiles: session.expected_files,
    createdAt: session.created_at,
    uploadCompletedAt: session.upload_completed_at,
    completedAt: terminal ? new Date().toISOString() : session.completed_at,
    counts,
    documentTypes,
    categories,
    items: rows
  };
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Brak aktywnej sesji.", 401);
  const url = new URL(request.url);
  const workspace = await resolveWorkspace(user, url.searchParams.get("workspaceId") ?? undefined);
  if (!workspace) return jsonError("Brak dostępu do firmy.", 403);
  const requestedSessionId = url.searchParams.get("sessionId")?.trim();

  const db = createServiceSupabaseClient();
  let session: SessionRow | null = null;
  if (requestedSessionId) {
    session = await sessionForUser(workspace.id, requestedSessionId, user.id);
  } else {
    const { data, error } = await db.from("document_import_sessions")
      .select("id,workspace_id,project_id,label,source_module,status,expected_files,created_by,upload_completed_at,completed_at,created_at,updated_at")
      .eq("workspace_id", workspace.id)
      .eq("created_by", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<SessionRow>();
    if (error) return jsonError(`Nie udało się znaleźć ostatniej sesji: ${error.message}`, 500);
    session = data;
  }
  if (!session) return NextResponse.json({ session: null }, { headers: { "Cache-Control": "no-store" } });

  try {
    return NextResponse.json({ session: await buildSummary(session) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Nie udało się podsumować sesji importu.", 500);
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Brak aktywnej sesji.", 401);
  let body: ImportSessionBody;
  try { body = await request.json() as ImportSessionBody; }
  catch { return jsonError("Nieprawidłowe dane sesji importu.", 400); }

  const workspace = await resolveWorkspace(user, body.workspaceId);
  if (!workspace) return jsonError("Brak dostępu do firmy.", 403);
  const db = createServiceSupabaseClient();

  if (body.action === "create") {
    const files = Array.isArray(body.files) ? body.files.slice(0, 1000) : [];
    if (!files.length) return jsonError("Sesja importu wymaga co najmniej jednego pliku.", 400);
    if (body.files && body.files.length > 1000) return jsonError("Sesja importu może zawierać maksymalnie 1000 plików.", 400);
    const projectId = typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;
    if (projectId) {
      const project = await getProjectForUser(user, projectId);
      if (!project || project.workspace_id !== workspace.id) return jsonError("Inwestycja nie należy do aktywnej firmy.", 422);
    }
    const sourceModule = normalizeDocumentSourceModule(body.sourceModule);
    const { data: session, error: sessionError } = await db.from("document_import_sessions").insert({
      workspace_id: workspace.id,
      project_id: projectId,
      label: body.label?.trim().slice(0, 160) || `Import ${new Date().toLocaleDateString("pl-PL")}`,
      source_module: sourceModule,
      status: "uploading",
      expected_files: files.length,
      created_by: user.id
    }).select("id").single<{ id: string }>();
    if (sessionError || !session) return jsonError(`Nie udało się utworzyć sesji importu: ${sessionError?.message ?? "brak danych"}`, 500);

    const items = files.map((file, index) => {
      const fileName = String(file.fileName ?? "").trim().slice(0, 500) || `Plik ${index + 1}`;
      return {
        session_id: session.id,
        workspace_id: workspace.id,
        ordinal: index + 1,
        relative_path: cleanPath(file.relativePath, fileName),
        file_name: fileName,
        file_size_bytes: Math.max(0, Math.round(Number(file.fileSize) || 0))
      };
    });
    const { data: insertedItems, error: itemsError } = await db.from("document_import_session_items")
      .insert(items).select("id,ordinal").returns<Array<{ id: string; ordinal: number }>>();
    if (itemsError) {
      await db.from("document_import_sessions").delete().eq("id", session.id);
      return jsonError(`Nie udało się utworzyć listy plików sesji: ${itemsError.message}`, 500);
    }
    return NextResponse.json({ sessionId: session.id, items: insertedItems ?? [] }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!body.sessionId) return jsonError("Brakuje identyfikatora sesji.", 400);
  const session = await sessionForUser(workspace.id, body.sessionId, user.id);
  if (!session) return jsonError("Nie znaleziono sesji importu.", 404);

  if (body.action === "fail") {
    if (!body.itemId) return jsonError("Brakuje identyfikatora pliku sesji.", 400);
    const { error } = await db.from("document_import_session_items").update({
      upload_status: "failed",
      error_message: String(body.error ?? "Upload nie powiódł się.").slice(0, 1800),
      updated_at: new Date().toISOString()
    }).eq("id", body.itemId).eq("session_id", session.id).eq("workspace_id", workspace.id);
    if (error) return jsonError(`Nie udało się zapisać błędu pliku: ${error.message}`, 500);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "finalize") {
    const { error } = await db.from("document_import_sessions").update({
      status: "processing",
      upload_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", session.id).eq("workspace_id", workspace.id);
    if (error) return jsonError(`Nie udało się zamknąć etapu uploadu: ${error.message}`, 500);
    const refreshed = await sessionForUser(workspace.id, session.id, user.id);
    return NextResponse.json({ session: refreshed ? await buildSummary(refreshed) : null }, { headers: { "Cache-Control": "no-store" } });
  }

  return jsonError("Nieobsługiwana akcja sesji importu.", 400);
}
