import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig, requireServerEnv } from "@/lib/env";

const JWT_FUTURE_ERROR = "JWT issued at future";
const JWT_CLOCK_SKEW_RETRY_DELAYS_MS = [1200, 2000] as const;
const nativeFetch = globalThis.fetch.bind(globalThis);

async function isJwtClockSkewResponse(response: Response) {
  if (response.ok) return false;
  try {
    return (await response.clone().text()).includes(JWT_FUTURE_ERROR);
  } catch {
    return false;
  }
}

const retryingServiceFetch: typeof fetch = async (...args) => {
  let response = await nativeFetch(...args);
  for (const delayMs of JWT_CLOCK_SKEW_RETRY_DELAYS_MS) {
    if (!await isJwtClockSkewResponse(response)) return response;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    response = await nativeFetch(...args);
  }
  return response;
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
