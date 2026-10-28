import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Octopus production stability regression", () => {
  it("bounds read-only Supabase calls while never replaying ambiguous writes", () => {
    const client = source("lib/supabase/service.ts");
    expect(client).toContain("SERVICE_READ_TIMEOUT_MS = 10_000");
    expect(client).toContain("AbortSignal.timeout(SERVICE_READ_TIMEOUT_MS)");
    expect(client).toContain("method === \"GET\" || method === \"HEAD\"");
    expect(client).toContain("!readOnly || transientRetryUsed");
    expect(client).toContain("TRANSIENT_READ_STATUSES.has(response.status)");
    expect(client).toContain("JWT_CLOCK_SKEW_RETRY_DELAYS_MS");
  });

  it("does not misrepresent failed financial reads as zero KPIs", () => {
    const finance = source("lib/data/finance-control-tower.ts");
    expect(finance).toContain("throw new Error(`Nie udało się pobrać danych finansowych");
    expect(finance).toContain("Nie udało się pobrać ${label}");
    expect(finance).toContain("const [graphInvoiceResult, paymentResult] = await Promise.all");
  });

  it("prevents applying stale AI suggestions to approved/exported entries and cross-company accounts", () => {
    const accounting = source("app/api/company/accounting/route.ts");
    const suggestion = accounting.split('if(body.action==="suggestion_apply"){')[1]?.split('if(body.action==="rule_save"){')[0] ?? "";
    expect(suggestion).toContain('suggestion.status!=="active"');
    expect(suggestion).toContain('.eq("workspace_id",workspace.id).eq("id",suggestion.line_id)');
    expect(suggestion).toContain('.eq("id",suggestion.suggested_account_id).eq("active",true)');
    expect(suggestion).toContain('!["proposed","rejected"].includes(entry.data.status)||entry.data.exported_at');
    expect(suggestion).toContain('if(reviewState.error)');
    expect(suggestion).toContain('if(applied.error)');
    expect(accounting).toContain('current.data.status==="approved"||current.data.exported_at');
  });

  it("reports permission-service failures instead of silently treating them as lack of access", () => {
    const auth = source("lib/authorization.ts");
    expect(auth).toContain("if (membershipError)");
    expect(auth).toContain("if (grantsError)");
    expect(auth).toContain("Nie udało się sprawdzić uprawnień firmy");
    expect(auth).toContain("Nie udało się pobrać uprawnień modułów");
  });

  it("does not replace missing warehouse AI quality counts with plausible zeros", () => {
    const warehouseAi = source("lib/data/warehouse-ai-300.ts");
    expect(warehouseAi).toContain("if (metric.error)");
    expect(warehouseAi).toContain("Nie udało się odczytać ${label} Magazynu");
  });

  it("runs the warehouse overview data reads concurrently instead of in waterfalls", () => {
    const warehouse = source("lib/data/warehouse-market-400.ts");
    expect(warehouse).toContain("const [base, ai, forecastsResult, readinessResult, recommendationsResult, pendingMovementsResult] = await Promise.all");
  });
});
