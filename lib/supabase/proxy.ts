import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/env";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const config = getPublicSupabaseConfig();

  if (!config) {
    return supabaseResponse;
  }

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Keep the request that reaches Server Components in sync with the
        // rotated session, then persist the same cookies back to the browser.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      }
    }
  });

  try {
    // Server Components cannot reliably persist rotated refresh tokens.
    // Refresh/verify once here so concurrent page requests receive one
    // consistent session and do not race on the same refresh token.
    await supabase.auth.getClaims();
  } catch {
    // Auth/network outages must not turn every public route into a 500.
    // The page-level auth guard will still decide whether access is allowed.
  }

  return supabaseResponse;
}
