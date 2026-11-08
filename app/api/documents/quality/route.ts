import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { domainForDocumentCategory, hasDomainAccess } from "@/lib/authorization";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { FieldQualityReport } from "@/lib/documents/field-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return reply({ error: "Brak aktywnej sesji." }, 401);
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId") ?? "", documentId = params.get("documentId") ?? "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(workspaceId) || !uuid.test(documentId)) return reply({ error: "Nieprawidłowe identyfikatory." }, 400);
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) return reply({ error: "Brak dostępu do firmy." }, 403);
  const db = createServiceSupabaseClient();
  const { data: document, error } = await db.from("documents").select("current_version_id,category,project_id")
    .eq("id", documentId).eq("workspace_id", workspaceId).is("deleted_at", null).maybeSingle();
  if (error) return reply({ error: "Nie udało się odczytać dokumentu." }, 500);
  if (!document) return reply({ error: "Nie znaleziono dokumentu." }, 404);
  if (!await hasDomainAccess({ workspaceId, userId: user.id, domain: domainForDocumentCategory(document.category), level: "read", projectId: document.project_id })) return reply({ error: "Brak uprawnień do dokumentu." }, 403);
  const { data: extraction, error: extractionError } = await db.from("document_extractions").select("payload")
    .eq("workspace_id", workspaceId).eq("document_version_id", document.current_version_id)
    .eq("extraction_type", "document_context").eq("schema_version", "document-analysis-v3").maybeSingle();
  if (extractionError) return reply({ error: "Nie udało się odczytać kontroli pól." }, 500);
  const report = extraction?.payload?.fieldQuality as FieldQualityReport | undefined;
  const offset = Math.max(0, Math.min(25_000, Number(params.get("offset")) || 0));
  const sorted = report?.fields ? [...report.fields].sort((a, b) => Number(["missing", "conflict"].includes(b.status)) - Number(["missing", "conflict"].includes(a.status))) : [];
  return reply({ report: report ? { ...report, fields: sorted.slice(offset, offset + 50), issues: report.issues.slice(0, 50) } : null,
    totalFields: sorted.length, offset, visualVerification: extraction?.payload?.visualVerification ?? null,
    segmentation: extraction?.payload?.pdfSegmentation ?? null });
}
