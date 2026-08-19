import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig, requireServerEnv } from "@/lib/env";

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
