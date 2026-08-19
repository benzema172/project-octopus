import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AuthenticatedUser } from "@/lib/types";

function userFromClaims(claims: unknown): AuthenticatedUser | null {
  if (!claims || typeof claims !== "object") {
    return null;
  }

  const value = claims as { sub?: unknown; email?: unknown };
  if (typeof value.sub !== "string" || !value.sub) {
    return null;
  }

  return {
    id: value.sub,
    email: typeof value.email === "string" ? value.email : undefined
  };
}

export const getCurrentUser = cache(async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error) {
      return null;
    }

    return userFromClaims(data?.claims);
  } catch {
    return null;
  }
});

export async function requireCurrentUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  return user;
}

export async function getRequestUser(request: Request): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (token) {
    const config = getPublicSupabaseConfig();

    if (!config) {
      return null;
    }

    const supabase = createClient(config.url, config.publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { data, error } = await supabase.auth.getClaims(token);

    if (error) {
      return null;
    }

    return userFromClaims(data?.claims);
  }

  return getCurrentUser();
}
