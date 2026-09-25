import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { DEMO_WORKSPACE_ID } from "@/lib/demo/blueprint";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const RESERVED_E2E_FILES = ["octopus-live-audit.pdf", "octopus-live-audit.xlsx"] as const;

type VersionRow = {
  document_id: string;
  file_name: string;
  r2_bucket: string;
  r2_object_key: string;
  created_at: string;
};

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });

  let body: { workspaceId?: string };
  try { body = await request.json() as { workspaceId?: string }; }
  catch { return NextResponse.json({ error: "Nieprawidłowe dane maintenance E2E." }, { status: 400 }); }

  if (body.workspaceId !== DEMO_WORKSPACE_ID) {
    return NextResponse.json({ error: "Maintenance E2E działa wyłącznie w izolowanym workspace demonstracyjnym." }, { status: 403 });
  }

  const db = createServiceSupabaseClient();
  const { data: demoOwner, error: ownerError } = await db.from("workspaces")
    .select("id")
    .eq("id", DEMO_WORKSPACE_ID)
    .eq("owner_id", user.id)
    .maybeSingle<{ id: string }>();
  if (ownerError || !demoOwner) {
    return NextResponse.json({ error: "Tylko właściciel konta demonstracyjnego może uruchomić maintenance E2E." }, { status: 403 });
  }

  const { data, error } = await db.from("document_versions")
    .select("document_id,file_name,r2_bucket,r2_object_key,created_at,documents!document_versions_document_id_fkey!inner(workspace_id)")
    .eq("documents.workspace_id", DEMO_WORKSPACE_ID)
    .in("file_name", [...RESERVED_E2E_FILES])
    .order("created_at", { ascending: false })
    .returns<Array<VersionRow & { documents: unknown }>>();
  if (error) return NextResponse.json({ error: "Nie udało się odczytać artefaktów E2E: " + error.message }, { status: 422 });

  const rows = (data ?? []) as Array<VersionRow & { documents: unknown }>;
  const keepDocumentIds = new Set<string>();
  for (const fileName of RESERVED_E2E_FILES) {
    const latest = rows.find((row) => row.file_name === fileName);
    if (latest) keepDocumentIds.add(latest.document_id);
  }

  const staleDocumentIds = Array.from(new Set(rows
    .filter((row) => !keepDocumentIds.has(row.document_id))
    .map((row) => row.document_id)));
  if (!staleDocumentIds.length) {
    return NextResponse.json({ ok: true, removedDocuments: 0, removedObjects: 0, keptDocuments: keepDocumentIds.size });
  }

  const staleRows = rows.filter((row) => staleDocumentIds.includes(row.document_id));
  const r2Config = getR2Config();
  const r2 = createR2Client();
  let removedObjects = 0;
  for (const row of staleRows) {
    if (!row.r2_object_key || row.r2_bucket !== r2Config.bucketName) continue;
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: row.r2_bucket, Key: row.r2_object_key }));
      removedObjects += 1;
    } catch (deleteError) {
      console.error("Project Octopus: E2E R2 cleanup failed", { documentId: row.document_id, objectKey: row.r2_object_key, deleteError });
      return NextResponse.json({ error: "Nie udało się bezpiecznie wyczyścić starego artefaktu E2E z R2." }, { status: 502 });
    }
  }

  const deleted = await db.from("documents")
    .delete()
    .eq("workspace_id", DEMO_WORKSPACE_ID)
    .in("id", staleDocumentIds)
    .select("id");
  if (deleted.error) {
    console.error("Project Octopus: E2E database cleanup failed after R2 cleanup", deleted.error);
    return NextResponse.json({ error: "R2 wyczyszczono, ale nie udało się usunąć starych rekordów E2E: " + deleted.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    removedDocuments: deleted.data?.length ?? 0,
    removedObjects,
    keptDocuments: keepDocumentIds.size
  }, { headers: { "Cache-Control": "no-store" } });
}
