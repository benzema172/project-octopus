import "server-only";

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getOptionalEnv, getR2Config } from "@/lib/env";

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, "");
}

function accountIdFromEndpoint(endpoint: string) {
  try {
    const host = new URL(endpoint).hostname;
    const match = host.match(/^([a-f0-9]{32})(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function endpointCandidates() {
  const config = getR2Config();
  const primary = normalizeEndpoint(config.endpoint);
  const accountId = getOptionalEnv("R2_ACCOUNT_ID") ?? accountIdFromEndpoint(primary);
  const candidates = new Set<string>([primary]);

  if (accountId) {
    candidates.add(`https://${accountId}.r2.cloudflarestorage.com`);
    candidates.add(`https://${accountId}.eu.r2.cloudflarestorage.com`);
    candidates.add(`https://${accountId}.fedramp.r2.cloudflarestorage.com`);
  }

  return [...candidates];
}

export function createR2Client(endpointOverride?: string) {
  const config = getR2Config();

  return new S3Client({
    region: "auto",
    endpoint: endpointOverride ? normalizeEndpoint(endpointOverride) : config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

let resolvedClientPromise: Promise<S3Client> | null = null;

async function resolveR2Client() {
  const config = getR2Config();
  const failures: string[] = [];

  for (const endpoint of endpointCandidates()) {
    const client = createR2Client(endpoint);
    try {
      await client.send(new ListObjectsV2Command({ Bucket: config.bucketName, MaxKeys: 1 }));
      return client;
    } catch (error) {
      const status = typeof error === "object" && error && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        : undefined;
      const name = error instanceof Error ? error.name : "R2Error";
      failures.push(`${new URL(endpoint).hostname}:${name}${status ? `(${status})` : ""}`);
      client.destroy();
    }
  }

  throw new Error(`Nie udało się uzyskać dostępu do bucketu R2 ${config.bucketName}. Sprawdzone endpointy: ${failures.join(", ")}.`);
}

export async function createResolvedR2Client() {
  if (!resolvedClientPromise) {
    resolvedClientPromise = resolveR2Client().catch((error) => {
      resolvedClientPromise = null;
      throw error;
    });
  }

  return resolvedClientPromise;
}
