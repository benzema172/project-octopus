"use client";

import { createBrowserClient } from "@supabase/ssr";
import { GUEST_PUBLIC_LOGIN, GUEST_PUBLIC_PASSWORD } from "@/lib/demo/guest-constants";
import { getPublicSupabaseConfig } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

type GuestBootstrapResponse = {
  email?: string;
  password?: string;
  error?: string;
};

export function createBrowserSupabaseClient() {
  if (browserClient) {
    return browserClient;
  }

  const config = getPublicSupabaseConfig();

  if (!config) {
    throw new Error("Supabase public configuration is missing.");
  }

  const client = createBrowserClient(config.url, config.publishableKey);
  const supabasePasswordSignIn = client.auth.signInWithPassword.bind(client.auth);

  client.auth.signInWithPassword = async (credentials) => {
    const login = "email" in credentials ? credentials.email.trim().toLocaleLowerCase("pl") : "";

    if (login === GUEST_PUBLIC_LOGIN && credentials.password === GUEST_PUBLIC_PASSWORD) {
      const response = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login, password: credentials.password })
      });
      const payload = await response.json().catch(() => ({})) as GuestBootstrapResponse;

      if (!response.ok || !payload.email || !payload.password) {
        throw new Error(payload.error || "Nie udało się przygotować środowiska demonstracyjnego.");
      }

      return supabasePasswordSignIn({ email: payload.email, password: payload.password });
    }

    return supabasePasswordSignIn(credentials);
  };

  browserClient = client;
  return browserClient;
}
