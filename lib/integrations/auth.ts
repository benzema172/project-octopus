import "server-only";

import { timingSafeEqual } from "node:crypto";

export const DOCUMENT_INGESTION_CHANNELS = new Set([
  "api", "email", "ksef", "erp", "subiekt", "comarch", "symfonia", "enova",
  "field_form", "mobile", "scanner", "sharepoint", "onedrive"
]);

export function authorizeIntegrationRequest(request: Request) {
  const expected = process.env.OCTOPUS_INTEGRATION_TOKEN?.trim();
  if (!expected) return { ok: false as const, status: 503, error: "Integracje zewnętrzne nie są skonfigurowane." };
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (!supplied || expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return { ok: false as const, status: 401, error: "Nieprawidłowy token integracyjny." };
  }
  return { ok: true as const };
}

export function normalizeIntegrationChannel(value: unknown) {
  if (typeof value !== "string") return null;
  const channel = value.trim().toLowerCase().replaceAll("-", "_");
  return DOCUMENT_INGESTION_CHANNELS.has(channel) ? channel : null;
}
