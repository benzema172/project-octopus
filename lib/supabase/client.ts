"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseConfig } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createBrowserSupabaseClient() {
  if (browserClient) {
    return browserClient;
  }

  const config = getPublicSupabaseConfig();

  if (!config) {
    throw new Error("Supabase public configuration is missing.");
  }

  browserClient = createBrowserClient(config.url, config.publishableKey);
  return browserClient;
}
