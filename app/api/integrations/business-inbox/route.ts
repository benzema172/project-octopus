import { timingSafeEqual } from "node:crypto";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type IntegrationBody = {
  workspaceId?: string;
  sourceChannel?: string;
  externalKey?: string;
  documentId?: string | null;
  projectId?: string | null;
  documentType?: string | null;
  payload?: Record<string, unknown>;
};

const ALLOWED_CHANNELS = new Set(["ksef", "erp", "subiekt", "comarch", "symfonia", "enova", "email", "api"]);

function authorized(request: Request) {
  const expected = process.env.OCTOPUS_INTEGRATION_TOKEN?.trim();
  if (!expected) return { ok: false as const, status: 503, error: "Integracje zewnętrzne nie są skonfigurowane." };
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (!supplied || expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return { ok: false as const, status: 401, error: "Nieprawidłowy token integracyjny." };
  }
  return { ok: true as const };
}

function optionalId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  const auth = authorized(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  let body: IntegrationBody;
  try { body = await request.json() as IntegrationBody; }
  catch { return Response.json({ error: "Nieprawidłowy JSON." }, { status: 400 }); }

  const workspaceId = optionalId(body.workspaceId);
  const externalKey = optionalId(body.externalKey);
  const sourceChannel = optionalId(body.sourceChannel)?.toLowerCase();
  const projectId = optionalId(body.projectId);
  const documentId = optionalId(body.documentId);
  const documentType = optionalId(body.documentType);
  if (!workspaceId || !externalKey || !sourceChannel) {
    return Response.json({ error: "Wymagane są workspaceId, sourceChannel i externalKey." }, { status: 400 });
  }
  if (!ALLOWED_CHANNELS.has(sourceChannel)) {
    return Response.json({ error: "Nieobsługiwany kanał integracyjny." }, { status: 400 });
  }

  const db = createServiceSupabaseClient();
  const { data: workspace } = await db.from("workspaces").select("id").eq("id", workspaceId).maybeSingle<{ id: string }>();
  if (!workspace) return Response.json({ error: "Nie znaleziono firmy." }, { status: 404 });

  if (projectId) {
    const { data: project } = await db.from("projects").select("id").eq("workspace_id", workspaceId).eq("id", projectId).maybeSingle<{ id: string }>();
    if (!project) return Response.json({ error: "Inwestycja nie należy do firmy." }, { status: 422 });
  }
  if (documentId) {
    const { data: document } = await db.from("documents").select("id").eq("workspace_id", workspaceId).eq("id", documentId).maybeSingle<{ id: string }>();
    if (!document) return Response.json({ error: "Dokument nie należy do firmy." }, { status: 422 });
  }

  const status = documentId ? "processing" : "new";
  const { data: inserted, error } = await db.from("business_inbox_items").upsert({
    workspace_id: workspaceId,
    source_channel: sourceChannel,
    external_key: externalKey,
    document_id: documentId,
    project_id: projectId,
    document_type: documentType,
    status,
    payload: body.payload && typeof body.payload === "object" ? body.payload : {},
    received_at: new Date().toISOString()
  }, { onConflict: "workspace_id,source_channel,external_key", ignoreDuplicates: true })
    .select("id,status")
    .maybeSingle<{ id: string; status: string }>();
  if (error) return Response.json({ error: error.message }, { status: 422 });

  if (!inserted) {
    const { data: existing, error: existingError } = await db.from("business_inbox_items")
      .select("id,status")
      .eq("workspace_id", workspaceId)
      .eq("source_channel", sourceChannel)
      .eq("external_key", externalKey)
      .maybeSingle<{ id: string; status: string }>();
    if (existingError || !existing) return Response.json({ error: existingError?.message ?? "Nie udało się potwierdzić istniejącego elementu integracji." }, { status: 422 });
    return Response.json({ ok: true, id: existing.id, status: existing.status, duplicate: true }, { status: 200 });
  }

  await db.from("audit_events").insert({
    workspace_id: workspaceId,
    project_id: projectId,
    actor_type: "integration",
    event_type: "business_inbox.external_received",
    entity_type: "business_inbox_item",
    entity_id: inserted.id,
    after_value: { sourceChannel, externalKey, documentType, hasDocument: Boolean(documentId) }
  });

  return Response.json({ ok: true, id: inserted.id, status: inserted.status, duplicate: false }, { status: 202 });
}
