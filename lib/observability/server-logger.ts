type LogLevel = "info" | "warn" | "error";

type ErrorLike = Error & { digest?: string; code?: string };

export type OperationalLog = {
  event: string;
  route?: string | null;
  method?: string | null;
  module?: string | null;
  action?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  requestId?: string | null;
  durationMs?: number | null;
  status?: number | string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorDigest?: string | null;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

function clean(value: unknown, max = 300) {
  if (value == null) return null;
  return String(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null;
}

function cleanMeta(meta?: OperationalLog["meta"]) {
  if (!meta) return undefined;
  return Object.fromEntries(Object.entries(meta).slice(0, 16).map(([key, value]) => [clean(key, 64), typeof value === "string" ? clean(value, 160) : value]));
}

export function errorFields(error: unknown) {
  const err = error instanceof Error ? error as ErrorLike : null;
  return {
    errorCode: clean(err?.code ?? "UNEXPECTED_ERROR", 80),
    errorMessage: clean(err?.message ?? error ?? "Unknown error", 400),
    errorDigest: clean(err?.digest, 160)
  };
}

export function operationalLog(level: LogLevel, input: OperationalLog) {
  const record = {
    timestamp: new Date().toISOString(),
    source: "project-octopus",
    environment: clean(process.env.VERCEL_ENV ?? process.env.NODE_ENV, 32),
    deploymentSha: clean(process.env.VERCEL_GIT_COMMIT_SHA, 64),
    event: clean(input.event, 100),
    route: clean(input.route, 220),
    method: clean(input.method, 16),
    module: clean(input.module, 80),
    action: clean(input.action, 100),
    workspaceId: clean(input.workspaceId, 64),
    projectId: clean(input.projectId, 64),
    requestId: clean(input.requestId, 100),
    durationMs: input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
    status: input.status ?? null,
    errorCode: clean(input.errorCode, 80),
    errorMessage: clean(input.errorMessage, 400),
    errorDigest: clean(input.errorDigest, 160),
    meta: cleanMeta(input.meta)
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function requestIdFrom(request: Request) {
  return clean(request.headers.get("x-request-id") ?? request.headers.get("x-vercel-id") ?? crypto.randomUUID(), 100) ?? crypto.randomUUID();
}
