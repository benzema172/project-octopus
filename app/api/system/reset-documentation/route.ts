import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

const BACKGROUND_TOKEN_HEADER = "x-octopus-background-token";
const RESET_CONFIRMATION = "RESET_DOCUMENTATION_1_3_3";
const STORAGE_PREFIX = "workspaces/";

type ResetBody = {
  confirmation?: string;
};

async function listWorkspaceObjectKeys() {
  const r2 = createR2Client();
  const { bucketName } = getR2Config();
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await r2.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: STORAGE_PREFIX,
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));

    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  r2.destroy();
  return keys;
}

async function deleteWorkspaceObjects(keys: string[]) {
  if (keys.length === 0) return;

  const r2 = createR2Client();
  const { bucketName } = getR2Config();

  for (let offset = 0; offset < keys.length; offset += 1000) {
    const batch = keys.slice(offset, offset + 1000);
    const result = await r2.send(new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: {
        Objects: batch.map((Key) => ({ Key })),
        Quiet: true
      }
    }));

    if ((result.Errors?.length ?? 0) > 0) {
      const summary = result.Errors?.map((error) => `${error.Key ?? "?"}:${error.Code ?? "R2_DELETE_ERROR"}`).join(", ");
      r2.destroy();
      throw new Error(`Nie udało się usunąć części obiektów R2: ${summary}`);
    }
  }

  r2.destroy();
}

export async function POST(request: Request) {
  const supabase = createServiceSupabaseClient();
  const backgroundToken = request.headers.get(BACKGROUND_TOKEN_HEADER)?.trim();

  if (!backgroundToken) {
    return NextResponse.json({ error: "Brak tokenu serwisowego." }, { status: 401 });
  }

  const { data: authorized, error: authorizationError } = await supabase.rpc("verify_background_worker_token", {
    p_token: backgroundToken
  });

  if (authorizationError || authorized !== true) {
    return NextResponse.json({ error: "Nieprawidłowy token serwisowy." }, { status: 401 });
  }

  let body: ResetBody;
  try {
    body = (await request.json()) as ResetBody;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane resetu." }, { status: 400 });
  }

  if (body.confirmation !== RESET_CONFIRMATION) {
    return NextResponse.json({ error: "Brak dokładnego potwierdzenia resetu dokumentacji." }, { status: 409 });
  }

  try {
    const objectsBefore = await listWorkspaceObjectKeys();
    await deleteWorkspaceObjects(objectsBefore);
    const objectsAfter = await listWorkspaceObjectKeys();

    if (objectsAfter.length !== 0) {
      return NextResponse.json({
        error: "Reset R2 nie został domknięty. Baza nie została wyczyszczona.",
        storage: { before: objectsBefore.length, remaining: objectsAfter.length }
      }, { status: 502 });
    }

    const { data: database, error: resetError } = await supabase.rpc("reset_documentation_records_133");
    if (resetError) {
      return NextResponse.json({
        error: `Pliki R2 usunięto, ale reset bazy wymaga ponowienia: ${resetError.message}`,
        storage: { before: objectsBefore.length, remaining: 0 }
      }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      release: "1.3.4",
      storage: {
        prefix: STORAGE_PREFIX,
        removed: objectsBefore.length,
        remaining: 0
      },
      database
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Nieznany błąd resetu dokumentacji."
    }, { status: 500 });
  }
}
