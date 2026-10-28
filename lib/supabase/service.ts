import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig, requireServerEnv } from "@/lib/env";

const JWT_FUTURE_ERROR = "JWT issued at future";
const JWT_CLOCK_SKEW_RETRY_DELAYS_MS = [1200, 2000] as const;
const SERVICE_READ_TIMEOUT_MS = 10_000;
const TRANSIENT_READ_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const nativeFetch = globalThis.fetch.bind(globalThis);

async function isJwtClockSkewResponse(response: Response) {
  if (response.ok) return false;
  try {
    return (await response.clone().text()).includes(JWT_FUTURE_ERROR);
  } catch {
    return false;
  }
}

// Limit only read requests. Aborting or retrying a write can leave its outcome
// ambiguous and may duplicate financial transactions, document uploads or jobs.
const retryingServiceFetch: typeof fetch = async (input, init) => {
  const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const readOnly = method === "GET" || method === "HEAD";
  const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  let transientRetryUsed = false;
  let clockSkewRetries = 0;

  while (true) {
    // A fresh deadline is needed for each attempt. Preserve caller cancellation.
    const deadline = readOnly ? AbortSignal.timeout(SERVICE_READ_TIMEOUT_MS) : null;
    const signal = deadline
      ? (upstreamSignal ? AbortSignal.any([upstreamSignal, deadline]) : deadline)
      : upstreamSignal;

    let response: Response;
    try {
      response = await nativeFetch(input, { ...init, ...(signal ? { signal } : {}) });
    } catch (error) {
      if (!readOnly || transientRetryUsed || upstreamSignal?.aborted) throw error;
      transientRetryUsed = true;
      await new Promise((resolve) => setTimeout(resolve, 350));
      continue;
    }

    if (await isJwtClockSkewResponse(response)) {
      if (clockSkewRetries >= JWT_CLOCK_SKEW_RETRY_DELAYS_MS.length) return response;
      const delayMs = JWT_CLOCK_SKEW_RETRY_DELAYS_MS[clockSkewRetries++];
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    if (readOnly && !transientRetryUsed && TRANSIENT_READ_STATUSES.has(response.status)) {
      transientRetryUsed = true;
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 350));
      continue;
    }

    return response;
  }
};

function buildServiceSupabaseClient() {
  const config = getPublicSupabaseConfig();

  if (!config) {
    throw new Error("Supabase public configuration is missing.");
  }

  return createClient(config.url, requireServerEnv("SUPABASE_SECRET_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    global: {
      fetch: retryingServiceFetch
    }
  });
}

type ServiceSupabaseClient = ReturnType<typeof buildServiceSupabaseClient>;

let serviceClient: ServiceSupabaseClient | null = null;

export function createServiceSupabaseClient(): ServiceSupabaseClient {
  if (!serviceClient) {
    serviceClient = buildServiceSupabaseClient();
  }

  return serviceClient;
}
