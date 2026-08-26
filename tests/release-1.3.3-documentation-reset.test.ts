import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/system/reset-documentation/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260826115000_documentation_reset_133.sql", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const release = readFileSync("lib/app-release.ts", "utf8");

describe("Project Octopus 1.3.3 — Documentation Reset", () => {
  it("uses a unique 1.3.3 release number", () => {
    expect(packageJson.version).toBe("1.3.3");
    expect(release).toContain('version: "1.3.3"');
  });

  it("requires the private background token and an exact destructive confirmation", () => {
    expect(route).toContain('x-octopus-background-token');
    expect(route).toContain('verify_background_worker_token');
    expect(route).toContain('RESET_DOCUMENTATION_1_3_3');
  });

  it("removes and then verifies the entire workspace R2 prefix before touching the database", () => {
    expect(route).toContain('const STORAGE_PREFIX = "workspaces/"');
    expect(route).toContain("DeleteObjectsCommand");
    expect(route).toContain("ListObjectsV2Command");
    expect(route).toContain("if (objectsAfter.length !== 0)");
    expect(route.indexOf('if (objectsAfter.length !== 0)')).toBeLessThan(route.indexOf('reset_documentation_records_133'));
  });

  it("clears uploaded documentation and old AI Brain facts without deleting manual operational modules", () => {
    expect(migration).toContain("delete from public.project_facts where created_by_ai is true");
    expect(migration).toContain("delete from public.entity_source_links");
    expect(migration).toContain("delete from public.documents");
    expect(migration).not.toContain("delete from public.boq_items");
    expect(migration).not.toContain("delete from public.materials");
    expect(migration).not.toContain("delete from public.invoices");
    expect(migration).not.toContain("delete from public.stock_movements");
  });

  it("keeps the reset RPC restricted to service_role", () => {
    expect(migration).toContain("revoke all on function public.reset_documentation_records_133() from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.reset_documentation_records_133() to service_role");
  });
});
