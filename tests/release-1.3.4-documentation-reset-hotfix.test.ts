import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260826121000_documentation_reset_134_hotfix.sql", "utf8");
const route = readFileSync("app/api/system/reset-documentation/route.ts", "utf8");

describe("Project Octopus 1.3.4 — Documentation Reset Hotfix", () => {
  it("keeps the historical reset endpoint identified as the 1.3.4 hotfix without freezing future app versions", () => {
    expect(route).toContain('release: "1.3.4"');
    expect(migration).toContain("Project Octopus 1.3.4");
  });

  it("complies with hosted Supabase safe-delete enforcement", () => {
    expect(migration).toContain("delete from public.documents where id is not null");
    expect(migration).not.toContain("delete from public.documents;");
  });

  it("keeps operational business modules out of the destructive reset", () => {
    expect(migration).not.toContain("delete from public.boq_items");
    expect(migration).not.toContain("delete from public.boq_versions");
    expect(migration).not.toContain("delete from public.invoices");
    expect(migration).not.toContain("delete from public.stock_movements");
  });

  it("keeps the reset RPC restricted to service_role", () => {
    expect(migration).toContain("revoke all on function public.reset_documentation_records_133() from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.reset_documentation_records_133() to service_role");
  });

  it("still verifies R2 is empty before invoking the database reset", () => {
    expect(route).toContain("if (objectsAfter.length !== 0)");
    expect(route.indexOf("if (objectsAfter.length !== 0)")).toBeLessThan(route.indexOf('supabase.rpc("reset_documentation_records_133")'));
  });
});
