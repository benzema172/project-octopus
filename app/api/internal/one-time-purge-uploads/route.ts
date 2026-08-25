import { createHash, timingSafeEqual } from "node:crypto";
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_SHA256 = "799622645ba9f0346954448cfff4430e177b8a686834f639a7e57578da88298d";

type VersionRow = {
  id: string;
  document_id: string;
  r2_object_key: string | null;
  object_key: string | null;
  extracted_text_object_key: string | null;
};

function authorized(rawToken: string | null) {
  if (!rawToken) return false;
  const expected = Buffer.from(TOKEN_SHA256, "hex");
  const actual = createHash("sha256").update(rawToken).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.name === "NoSuchKey" || candidate.$metadata?.httpStatusCode === 404;
}

async function countRows(table: string) {
  const db = createServiceSupabaseClient();
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`Nie udało się policzyć ${table}: ${error.message}`);
  return count ?? 0;
}

async function listDocumentObjectKeys(r2: S3Client, bucketName: string) {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await r2.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: "workspace/",
      ContinuationToken: continuationToken
    }));
    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (key && key.includes("/documents/")) keys.push(key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return [...new Set(keys)];
}

async function deleteObjectKeys(r2: S3Client, bucketName: string, keys: string[]) {
  for (let offset = 0; offset < keys.length; offset += 1000) {
    const batch = keys.slice(offset, offset + 1000);
    const deleted = await r2.send(new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: { Quiet: false, Objects: batch.map((Key) => ({ Key })) }
    }));
    if (deleted.Errors?.length) {
      throw new Error(`R2 delete failed: ${deleted.Errors.map((entry) => `${entry.Key ?? "?"}:${entry.Code ?? "error"}`).join(", ")}`);
    }
  }
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ error: "Purge jest dozwolony wyłącznie na produkcji." }, { status: 403 });
  }

  const url = new URL(request.url);
  if (!authorized(url.searchParams.get("token"))) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const db = createServiceSupabaseClient();
  const { data: versions, error: versionsError } = await db
    .from("document_versions")
    .select("id,document_id,r2_object_key,object_key,extracted_text_object_key")
    .returns<VersionRow[]>();

  if (versionsError) {
    return NextResponse.json({ error: `Nie udało się odczytać wersji dokumentów: ${versionsError.message}` }, { status: 500 });
  }

  const rows = versions ?? [];
  const documentIds = [...new Set(rows.map((row) => row.document_id).filter(Boolean))];
  const trackedObjectKeys = [...new Set(rows.flatMap((row) => [row.r2_object_key, row.object_key, row.extracted_text_object_key]).filter((key): key is string => Boolean(key?.trim())))];

  const { bucketName } = getR2Config();
  const r2 = createR2Client();
  const bucketDocumentKeys = await listDocumentObjectKeys(r2, bucketName);
  const allObjectKeys = [...new Set([...trackedObjectKeys, ...bucketDocumentKeys])];
  const orphanObjectKeys = bucketDocumentKeys.filter((key) => !trackedObjectKeys.includes(key));

  if (allObjectKeys.length > 0) {
    try {
      await deleteObjectKeys(r2, bucketName, allObjectKeys);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "R2 zgłosiło błąd podczas kasowania obiektów." }, { status: 500 });
    }

    const remainingTracked = (await Promise.all(trackedObjectKeys.map(async (Key) => {
      try {
        await r2.send(new HeadObjectCommand({ Bucket: bucketName, Key }));
        return Key;
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    }))).filter((key): key is string => Boolean(key));

    const remainingBucketDocumentKeys = await listDocumentObjectKeys(r2, bucketName);
    if (remainingTracked.length > 0 || remainingBucketDocumentKeys.length > 0) {
      return NextResponse.json({
        error: "Nie wszystkie obiekty dokumentów zniknęły z R2. Baza danych nie została wyczyszczona.",
        remainingTracked,
        remainingBucketDocumentKeys
      }, { status: 500 });
    }
  }

  if (documentIds.length > 0) {
    const { error: dataRoomError } = await db.from("data_room_documents").delete().in("document_id", documentIds);
    if (dataRoomError) {
      return NextResponse.json({ error: `R2 wyczyszczone, ale nie udało się usunąć powiązań data room: ${dataRoomError.message}` }, { status: 500 });
    }

    const { error: documentsError } = await db.from("documents").delete().in("id", documentIds);
    if (documentsError) {
      return NextResponse.json({ error: `R2 wyczyszczone, ale nie udało się usunąć dokumentów z bazy: ${documentsError.message}` }, { status: 500 });
    }
  }

  const after = {
    documentVersions: await countRows("document_versions"),
    extractions: await countRows("document_extractions"),
    classifications: await countRows("document_classifications"),
    analysisSegments: await countRows("document_analysis_segments"),
    moduleProposals: await countRows("document_module_proposals"),
    chunks: await countRows("document_chunks"),
    processingJobs: await countRows("processing_jobs"),
    estimateImports: await countRows("estimate_imports")
  };
  const finalBucketDocumentKeys = await listDocumentObjectKeys(r2, bucketName);

  return NextResponse.json({
    ok: true,
    deleted: {
      r2Objects: allObjectKeys.length,
      trackedR2Objects: trackedObjectKeys.length,
      orphanR2Objects: orphanObjectKeys.length,
      uploadedDocuments: documentIds.length,
      documentVersions: rows.length
    },
    verified: {
      r2Remaining: finalBucketDocumentKeys.length,
      ...after
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
