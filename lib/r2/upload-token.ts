import { createHmac, timingSafeEqual } from "node:crypto";

export type UploadIntent = {
  workspaceId: string;
  projectId: string;
  documentId: string;
  versionId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  expiresAt: number;
};

function isUploadIntent(value: unknown): value is UploadIntent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const intent = value as Record<string, unknown>;

  return (
    typeof intent.workspaceId === "string" &&
    typeof intent.projectId === "string" &&
    typeof intent.documentId === "string" &&
    typeof intent.versionId === "string" &&
    typeof intent.objectKey === "string" &&
    typeof intent.fileName === "string" &&
    typeof intent.mimeType === "string" &&
    typeof intent.fileSize === "number" &&
    Number.isFinite(intent.fileSize) &&
    intent.fileSize > 0 &&
    typeof intent.expiresAt === "number" &&
    Number.isFinite(intent.expiresAt)
  );
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createUploadToken(intent: UploadIntent, secret: string): string {
  const payload = base64UrlEncode(JSON.stringify(intent));
  const signature = signPayload(payload, secret);

  return `${payload}.${signature}`;
}

export function verifyUploadToken(token: string, secret: string, now = Date.now()): UploadIntent {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    throw new Error("Nieprawidłowy token uploadu.");
  }

  const expectedSignature = signPayload(payload, secret);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Token uploadu nie pasuje do podpisu.");
  }

  let intent: unknown;

  try {
    intent = JSON.parse(base64UrlDecode(payload));
  } catch {
    throw new Error("Token uploadu zawiera nieprawidłowe dane.");
  }

  if (!isUploadIntent(intent)) {
    throw new Error("Token uploadu ma nieprawidłową strukturę.");
  }

  if (!intent.expiresAt || intent.expiresAt < now) {
    throw new Error("Token uploadu wygasł.");
  }

  return intent;
}
