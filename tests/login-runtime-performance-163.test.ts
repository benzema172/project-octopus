import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("login and public runtime performance", () => {
  it("does not server-render the heavy animated login grid", () => {
    const page = read("app/page.tsx");
    const client = read("components/auth/project-octopus-login-client.tsx");

    expect(page).toContain("ProjectOctopusLoginClient");
    expect(page).not.toContain('from "@/components/auth/project-octopus-login"');
    expect(client).toContain('dynamic(');
    expect(client).toContain('ssr: false');
    expect(client).toContain('import("@/components/auth/project-octopus-login")');
    expect(client).toContain("Uruchamianie panelu logowania");
  });

  it("keeps crawler metadata away from the Supabase session proxy", () => {
    const proxy = read("proxy.ts");
    const robots = read("app/robots.ts");

    expect(proxy).toContain("robots.txt");
    expect(proxy).toContain("sitemap.xml");
    expect(robots).toContain('disallow: "/"');
  });
});
