import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig, requireServerEnv } from "@/lib/env";

let serviceClient: ReturnType<typeof createClient> | null = null;

export function createServiceSupabaseClient() {
  if (serviceClient) {
    return serviceClient;
  }

  const config = getPublicSupabaseConfig();

  if (!config) {
    throw new Error("Supabase public configuration is missing.");
  }

  serviceClient = createClient(config.url, requireServerEnv("SUPABASE_SECRET_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  return serviceClient;
}
