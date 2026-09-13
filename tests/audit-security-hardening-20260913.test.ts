import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("full app audit hardening 2026-09-13", () => {
  it("runs Document Flow with invoker privileges and removes browser execute from internal definer functions", () => {
    const migration = read("supabase/migrations/20260913201500_security_hardening_document_flow.sql");

    expect(migration).toContain("alter view public.document_flow_v2 set (security_invoker = true)");
    expect(migration).toContain("auto_receive_purchase_invoice_atomic(uuid, uuid, uuid)");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("prevent_redundant_receipt_price_observation()");
    expect(migration).toContain("cleanup_redundant_receipt_price_after_invoice()");
    expect(migration).toContain("reconcile_approved_business_document_proposals()");
  });

  it("does not schedule the retired Fleet Intelligence cron", () => {
    const vercel = read("vercel.json");
    expect(vercel).not.toContain("/api/cron/fleet-intelligence");
    expect(vercel).toContain("/api/cron/warehouse-intelligence");
  });

  it("runs live production audits after every main push and waits for the exact release", () => {
    const workflow = read(".github/workflows/e2e-staging.yml");
    const waitScript = read("scripts/wait-for-production-commit.mjs");

    expect(workflow).toContain("branches: [main]");
    expect(workflow).not.toContain('scripts/e2e-live-trigger.txt');
    expect(workflow).toContain("node scripts/wait-for-production-commit.mjs");
    expect(workflow).toContain("node scripts/e2e-live-audit.mjs");
    expect(workflow).toContain("node scripts/e2e-live-security.mjs");
    expect(waitScript).toContain("GITHUB_SHA");
    expect(waitScript).toContain("Production is serving expected commit");
  });
});
