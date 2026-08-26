export type GeminiRateLimitInfo = {
  retryAfterMs: number;
  retryAt: string;
  rawMessage: string;
};

const DEFAULT_RETRY_MS = 60_000;
const MIN_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function clampRetry(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return DEFAULT_RETRY_MS;
  return Math.max(MIN_RETRY_MS, Math.min(MAX_RETRY_MS, Math.ceil(milliseconds)));
}

function secondsFromMessage(message: string) {
  const candidates = [
    /"retryDelay"\s*:\s*"([0-9.]+)s"/i,
    /retryDelay[^0-9]*([0-9.]+)s/i,
    /retry\s+(?:in|after)\s+([0-9.]+)\s*s/i,
    /spr[oó]buj ponownie za\s+([0-9.]+)\s*s/i
  ];
  for (const pattern of candidates) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
}

export function geminiRateLimitInfo(error: unknown, now = Date.now()): GeminiRateLimitInfo | null {
  const message = errorMessage(error);
  if (!message) return null;
  const normalized = message.toLowerCase();
  const rateLimited = normalized.includes("http 429")
    || normalized.includes("resource_exhausted")
    || normalized.includes("quota exceeded")
    || normalized.includes("rate limit");
  if (!rateLimited) return null;

  const seconds = secondsFromMessage(message);
  const retryAfterMs = clampRetry(seconds == null ? DEFAULT_RETRY_MS : seconds * 1000);
  return {
    retryAfterMs,
    retryAt: new Date(now + retryAfterMs).toISOString(),
    rawMessage: message
  };
}

export function geminiRateLimitMessage(info: GeminiRateLimitInfo) {
  const seconds = Math.max(1, Math.ceil(info.retryAfterMs / 1000));
  return `Limit Gemini jest chwilowo wykorzystany. Analiza pozostaje w kolejce i może zostać wznowiona automatycznie za około ${seconds} s.`;
}

export function millisecondsUntil(value: string | null | undefined, now = Date.now()) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, timestamp - now);
}

export function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}
