import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getProcessingQueueHealth } from "@/lib/data/operations";
import { getWorkspaceForUser } from "@/lib/data/workspace";
import { getAiRuntimeStatus, getOptionalEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return NextResponse.json({ error: "Brakuje identyfikatora firmy." }, { status: 400 });

  const configuredSecret = getOptionalEnv("CRON_SECRET");
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const monitorAuthorized = Boolean(configuredSecret && bearer === configuredSecret);
  if (!monitorAuthorized) {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: "Brak aktywnej sesji." }, { status: 401 });
    const workspace = await getWorkspaceForUser(user, workspaceId);
    if (!workspace || !await hasDomainAccess({ workspaceId, userId: user.id, domain: "settings", level: "read" })) {
      return NextResponse.json({ error: "Brak dostępu do monitoringu firmy." }, { status: 403 });
    }
  }

  const health = await getProcessingQueueHealth(workspaceId);
  return NextResponse.json({ ok: health.state !== "critical", ai: getAiRuntimeStatus(), queue: health }, {
    status: health.state === "critical" ? 503 : 200,
    headers: { "Cache-Control": "no-store" }
  });
}
