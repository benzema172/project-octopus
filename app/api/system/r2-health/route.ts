import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { GUEST_AUTH_EMAIL } from "@/lib/demo/guest-constants";
import { getR2Config } from "@/lib/env";
import { operationalLog, requestIdFrom } from "@/lib/observability/server-logger";
import { createR2Client } from "@/lib/r2/client";

function errorDetails(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError", message: String(error) };
  const candidate = error as Error & { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return {
    name: candidate.name ?? candidate.Code ?? "Error",
    message: candidate.message,
    status: candidate.$metadata?.httpStatusCode ?? null
  };
}

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const user = await getRequestUser(request);
  if (!user || user.email?.toLocaleLowerCase("pl") !== GUEST_AUTH_EMAIL) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const config = getR2Config();
  const r2 = createR2Client();
  const key = `system/live-e2e-health/${crypto.randomUUID()}.txt`;

  try {
    await r2.send(new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: "Project Octopus R2 health probe",
      ContentType: "text/plain; charset=utf-8"
    }));

    await r2.send(new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: key
    }));

    operationalLog("info", {
      event: "r2_server_health_ok",
      route: "/api/system/r2-health",
      method: "POST",
      requestId,
      status: 200
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const details = errorDetails(error);
    operationalLog("error", {
      event: "r2_server_health_failed",
      route: "/api/system/r2-health",
      method: "POST",
      requestId,
      status: details.status ?? 502,
      errorCode: details.name,
      errorMessage: details.message
    });
    return NextResponse.json({
      ok: false,
      error: details.name,
      message: details.message,
      status: details.status
    }, { status: 502 });
  }
}
