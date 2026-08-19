import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { GUEST_AUTH_EMAIL } from "@/lib/demo/guest-constants";
import { operationalLog, requestIdFrom } from "@/lib/observability/server-logger";

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const user = await getRequestUser(request);
  if (!user || user.email?.toLocaleLowerCase("pl") !== GUEST_AUTH_EMAIL) {
    operationalLog("warn", {
      event: "live_e2e_report_rejected",
      route: "/api/system/live-e2e-report",
      method: "POST",
      requestId,
      status: 403
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as {
    stage?: unknown;
    status?: unknown;
    message?: unknown;
    fileName?: unknown;
  };

  operationalLog("error", {
    event: "live_e2e_failure",
    route: "/api/system/live-e2e-report",
    method: "POST",
    requestId,
    status: typeof body.status === "number" || typeof body.status === "string" ? body.status : "failed",
    errorCode: typeof body.stage === "string" ? body.stage : "E2E_FAILURE",
    errorMessage: typeof body.message === "string" ? body.message : "Live E2E failed without a diagnostic message",
    meta: {
      fileName: typeof body.fileName === "string" ? body.fileName : null
    }
  });

  return new NextResponse(null, { status: 204 });
}
