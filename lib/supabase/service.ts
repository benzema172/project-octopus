import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig, requireServerEnv } from "@/lib/env";

export function createServiceSupabaseClient() {
  const config = getPublicSupabaseConfig();

  if (!config) {
    throw new Error("Supabase public configuration is missing.");
  }

  return createClient(config.url, requireServerEnv("SUPABASE_SECRET_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
