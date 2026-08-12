import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { analyzeDocumentWithGemini } from "@/lib/ai/gemini-document";
import { persistDocumentAnalysis } from "@/lib/ai/persist-document-analysis";
import { getRequestUser } from "@/lib/auth";
import { normalizeDocumentCategory } from "@/lib/documents/classification";
import { extractLocalDocument } from "@/lib/documents/extract";
import { getOptionalEnv, getR2Config } from "@/lib/env";
import { getProjectForUser } from "@/lib/data/projects";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PROCESSING_BYTES = 100 * 1024 * 1024;

type ProcessBody = {
  projectId?: string;
  documentId?: string;
  versionId?: string;
  lockCategory?: boolean;
};

type VersionRow = {
  id: string;
  document_id: string;
  project_id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  r2_object_key: string;
};

type DocumentRow = {
  id: string;
  category: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Brak aktywnej sesji.", 401);

  let body: ProcessBody;
  try {
    body = await request.json() as ProcessBody;
  } catch {
    return jsonError("Nieprawidłowe dane analizy dokumentu.", 400);
  }

  if (!body.projectId || !body.documentId || !body.versionId) {
    return jsonError("Brakuje identyfikatora inwestycji, dokumentu lub wersji.", 400);
  }

  const project = await getProjectForUser(user, body.projectId);
  if (!project) return jsonError("Nie znaleziono inwestycji.", 404);

  const supabase = createServiceSupabaseClient();
  const [{ data: version, error: versionReadError }, { data: document, error: documentReadError }] = await Promise.all([
    supabase.from("document_versions")
      .select("id,document_id,project_id,file_name,mime_type,file_size_bytes,r2_object_key")
      .eq("id", body.versionId)
      .eq("document_id", body.documentId)
      .eq("project_id", project.id)
      .maybeSingle<VersionRow>(),
    supabase.from("documents")
      .select("id,category")
      .eq("id", body.documentId)
      .eq("project_id", project.id)
      .maybeSingle<DocumentRow>()
  ]);

  if (versionReadError || documentReadError) {
    return jsonError(`Nie udało się pobrać dokumentu: ${versionReadError?.message ?? documentReadError?.message}`, 500);
  }
  if (!version || !document) return jsonError("Nie znaleziono wersji dokumentu w tej inwestycji.", 404);
  if (version.file_size_bytes > MAX_PROCESSING_BYTES) {
    return jsonError("Automatyczna analiza pojedynczego pliku jest obecnie ograniczona do 100 MB. Podziel większy dokument na części.", 413);
  }

  const model = getOptionalEnv("GEMINI_MODEL") ?? "gemini-2.5-flash-lite";
  const { data: aiRun, error: runError } = await supabase.from("ai_runs").insert({
    project_id: project.id,
    provider: "gemini",
    model,
    status: "processing",
    input: {
      document_id: document.id,
      document_version_id: version.id,
      file_name: version.file_name,
      initial_category: document.category,
      category_locked: Boolean(body.lockCategory)
    },
    created_by: user.id
  }).select("id").single<{ id: string }>();

  if (runError || !aiRun) return jsonError(`Nie udało się rozpocząć analizy AI: ${runError?.message ?? "brak danych"}`, 500);

  await supabase.from("document_versions").update({ upload_status: "processing" }).eq("id", version.id);

  try {
    const r2 = createR2Client();
    const r2Config = getR2Config();
    const object = await r2.send(new GetObjectCommand({ Bucket: r2Config.bucketName, Key: version.r2_object_key }));
    if (!object.Body) throw new Error("R2 nie zwrócił treści pliku.");
    const bytes = await object.Body.transformToByteArray();
    const buffer = Buffer.from(bytes);
    const extracted = extractLocalDocument(buffer, version.file_name, version.mime_type);
    const isPdf = version.mime_type.includes("pdf") || version.file_name.toLowerCase().endsWith(".pdf");

    const analysis = await analyzeDocumentWithGemini({
      fileName: version.file_name,
      mimeType: version.mime_type,
      existingCategory: document.category,
      extractedText: extracted?.text ?? null,
      pdfBuffer: isPdf ? buffer : null
    });

    const existingCategory = normalizeDocumentCategory(document.category);
    const finalCategory = body.lockCategory && existingCategory
      ? existingCategory
      : analysis.confidence >= 0.68
        ? analysis.category
        : "do_weryfikacji";

    await persistDocumentAnalysis({
      projectId: project.id,
      documentId: document.id,
      versionId: version.id,
      aiRunId: aiRun.id,
      finalCategory,
      extracted,
      analysis
    });

    const output = {
      category: finalCategory,
      ai_category: analysis.category,
      confidence: analysis.confidence,
      summary: analysis.summary,
      extraction_method: extracted?.method ?? "pdf-gemini",
      warnings: extracted?.warnings ?? [],
      counts: {
        facts: analysis.facts.length,
        materials: analysis.materials.length,
        devices: analysis.devices.length,
        boq_items: analysis.boq_items.length,
        findings: analysis.findings.length
      }
    };

    const { error: finishRunError } = await supabase.from("ai_runs").update({ status: "completed", output, error: null }).eq("id", aiRun.id);
    if (finishRunError) throw new Error(`Analiza została zapisana, ale nie udało się zamknąć przebiegu AI: ${finishRunError.message}`);

    return NextResponse.json({ ok: true, ...output }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany błąd analizy dokumentu.";
    await Promise.all([
      supabase.from("ai_runs").update({ status: "failed", error: message }).eq("id", aiRun.id),
      supabase.from("document_versions").update({ upload_status: "processing_failed" }).eq("id", version.id)
    ]);
    return jsonError(message, 500);
  }
}
