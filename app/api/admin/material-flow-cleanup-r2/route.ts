import { timingSafeEqual } from "node:crypto";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getOptionalEnv, getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const BACKGROUND_TOKEN_HEADER = "x-octopus-background-token";
const CLEANUP_CONFIRMATION = "RESET_MATERIAL_FLOW_FILES";

function safeSecretEqual(expected: string | null | undefined, received: string | null | undefined) {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function authorized(request: Request) {
  const configuredSecret = getOptionalEnv("CRON_SECRET");
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (safeSecretEqual(configuredSecret, bearer)) return true;
  const backgroundToken = request.headers.get(BACKGROUND_TOKEN_HEADER)?.trim();
  if (!backgroundToken) return false;
  const db = createServiceSupabaseClient();
  const { data, error } = await db.rpc("verify_background_worker_token", { p_token: backgroundToken });
  return !error && data === true;
}

export async function POST(request: Request) {
  if (!await authorized(request)) {
    return NextResponse.json({ error: "Brak uprawnień do operacji porządkowej." }, { status: 401 });
  }

  let body: { workspaceId?: string; objectKeys?: string[]; confirmation?: string };
  try {
    body = await request.json() as { workspaceId?: string; objectKeys?: string[]; confirmation?: string };
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane operacji." }, { status: 400 });
  }

  const workspaceId = String(body.workspaceId ?? "").trim();
  const keys = Array.from(new Set((body.objectKeys ?? []).map((value) => String(value).trim()).filter(Boolean)));
  if (!workspaceId || body.confirmation !== CLEANUP_CONFIRMATION) {
    return NextResponse.json({ error: "Brakuje potwierdzenia zakresu operacji." }, { status: 400 });
  }
  if (!keys.length || keys.length > 50) {
    return NextResponse.json({ error: "Operacja wymaga od 1 do 50 kluczy R2." }, { status: 400 });
  }

  const expectedPrefix = `workspaces/${workspaceId}/`;
  if (keys.some((key) => !key.startsWith(expectedPrefix) || key.includes(".."))) {
    return NextResponse.json({ error: "Co najmniej jeden klucz wykracza poza workspace." }, { status: 400 });
  }

  const config = getR2Config();
  const r2 = createR2Client();
  const response = await r2.send(new DeleteObjectsCommand({
    Bucket: config.bucketName,
    Delete: {
      Objects: keys.map((Key) => ({ Key })),
      Quiet: false
    }
  }));

  const deleted = (response.Deleted ?? []).map((item) => item.Key).filter((value): value is string => Boolean(value));
  const errors = (response.Errors ?? []).map((item) => ({ key: item.Key ?? null, code: item.Code ?? null, message: item.Message ?? null }));
  return NextResponse.json({
    ok: errors.length === 0,
    bucket: config.bucketName,
    requested: keys.length,
    deleted: deleted.length,
    deletedKeys: deleted,
    errors
  }, { status: errors.length ? 207 : 200, headers: { "Cache-Control": "no-store" } });
}
