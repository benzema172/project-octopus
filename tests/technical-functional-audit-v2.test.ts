import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readJsonBody } from "../lib/http/json-body";

const migration = readFileSync(
  "supabase/migrations/20260824091940_technical_functional_audit_v2.sql",
  "utf8"
);
const recordsRoute = readFileSync("app/api/company/records/route.ts", "utf8");
const automationRoute = readFileSync("app/api/settings/automation/route.ts", "utf8");
const powerRoute = readFileSync("app/api/company/power/route.ts", "utf8");
const operationsRoute = readFileSync("app/api/projects/operations/route.ts", "utf8");
const assistantRoute = readFileSync("app/api/assistant/route.ts", "utf8");
const workspaceData = readFileSync("lib/data/workspace.ts", "utf8");
const workspaceError = readFileSync("app/workspace/error.tsx", "utf8");

describe("bounded JSON request reader", () => {
  it("accepts a valid JSON object", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ok" })
    });
    await expect(readJsonBody<{ action: string }>(request)).resolves.toEqual({ action: "ok" });
  });

  it("rejects unsupported media, malformed JSON and bodies over the byte limit", async () => {
    const unsupported = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}"
    });
    await expect(readJsonBody(unsupported)).rejects.toMatchObject({ status: 415 });

    const malformed = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{"
    });
    await expect(readJsonBody(malformed)).rejects.toMatchObject({ status: 400 });

    const oversized = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "ąąą" })
    });
    await expect(readJsonBody(oversized, 8)).rejects.toMatchObject({ status: 413 });
  });
});

describe("technical and functional audit v2 contract", () => {
  it("moves report aggregation into one database transaction", () => {
    expect(recordsRoute).toContain("create_report_snapshot_atomic");
    expect(recordsRoute).not.toContain('supabase.from("projects").select("id,status")');
    expect(migration).toContain("function public.create_report_snapshot_atomic");
    expect(migration).toContain("'report_snapshot.generated'");
  });

  it("deduplicates automation alerts under concurrent scans", () => {
    expect(migration).toContain("notifications_active_automation_uidx");
    expect(migration).toContain("function public.enqueue_automation_notifications_atomic");
    expect(migration).toContain("on conflict (workspace_id, event_type, entity_type, entity_id)");
    expect(automationRoute).toContain("enqueue_automation_notifications_atomic");
  });

  it("serializes employment periods and audits them atomically", () => {
    expect(migration).toContain("function public.create_employment_atomic");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("daterange(e.valid_from");
    expect(powerRoute).toContain("create_employment_atomic");
    expect(powerRoute).toContain("Koszt zatrudnienia nie może być ujemny");
  });

  it("bounds core JSON requests and validates external/geo failure modes", () => {
    for (const route of [recordsRoute, automationRoute, powerRoute, operationsRoute, assistantRoute]) {
      expect(route).toContain("readJsonBody");
      expect(route).toContain("JsonBodyError");
    }
    expect(operationsRoute).toContain("Współrzędne zdarzenia są poza dozwolonym zakresem");
    expect(assistantRoute).toContain('error.name === "TimeoutError"');
    expect(assistantRoute).toContain("504");
  });

  it("recovers the workspace entry point from schema drift and expired sessions", () => {
    expect(workspaceData).toContain("isMissingWorkspaceProjectCountsFunction");
    expect(workspaceData).toContain('select("id", { count: "exact", head: true })');
    expect(workspaceError).toContain("Spróbuj ponownie");
    expect(workspaceError).toContain('/auth/sign-out');
    expect(workspaceError).toContain('role="alert"');
  });
});
