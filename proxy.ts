import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  let rewriteTarget: URL | null = null;
  if (request.method === "POST" && request.nextUrl.pathname === "/api/company/records") {
    try {
      const body = await request.clone().json() as { entity?: string };
      if (body.entity === "ai_warehouse_import" || body.entity === "reservation") {
        rewriteTarget = request.nextUrl.clone();
        rewriteTarget.pathname = "/api/company/warehouse-atomic";
      }
    } catch {
      // The original route owns malformed-body validation.
    }
  }

  const buildResponse = () => rewriteTarget
    ? NextResponse.rewrite(rewriteTarget, { request })
    : NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) return buildResponse();

  let response = buildResponse();
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = buildResponse();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
