import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootProxy = readFileSync("proxy.ts", "utf8");
const sessionProxy = readFileSync("lib/supabase/proxy.ts", "utf8");

describe("Supabase SSR session proxy", () => {
  it("refreshes auth before Server Components and persists rotated cookies", () => {
    expect(rootProxy).toContain('import { updateSession } from "@/lib/supabase/proxy"');
    expect(rootProxy).toContain("return updateSession(request)");
    expect(sessionProxy).toContain("createServerClient");
    expect(sessionProxy).toContain("request.cookies.getAll()");
    expect(sessionProxy).toContain("request.cookies.set(name, value)");
    expect(sessionProxy).toContain("supabaseResponse.cookies.set(name, value, options)");
    expect(sessionProxy).toContain("await supabase.auth.getClaims()");
  });

  it("forwards SSR cache headers and fails open on transient auth-network errors", () => {
    expect(sessionProxy).toContain("Object.entries(headers)");
    expect(sessionProxy).toContain("supabaseResponse.headers.set(key, value)");
    expect(sessionProxy).toContain("catch {");
  });

  it("does not run the proxy for immutable Next assets and common image files", () => {
    expect(rootProxy).toContain("_next/static|_next/image|favicon.ico");
    expect(rootProxy).toContain("svg|png|jpg|jpeg|gif|webp");
  });
});
