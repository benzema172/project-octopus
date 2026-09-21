import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Action Center Refresh Core 6", () => {
  it("moves operational notification refresh to Next after()", () => {
    const page = source("app/workspace/companies/[workspaceId]/page.tsx");
    expect(page).toContain('import { after } from "next/server"');
    expect(page).toContain("after(async () =>");
    expect(page).toContain("await refreshOperationalNotifications(workspace.id)");
    expect(page).not.toContain("void refreshOperationalNotifications");
  });

  it("coalesces burst refreshes per workspace for 90 seconds", () => {
    const sql = source("supabase/migrations/20260921094500_action_center_refresh_core_6.sql");
    expect(sql).toContain("operational_notification_refresh_state");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("interval '90 seconds'");
    expect(sql).toContain("'reason', 'fresh'");
  });

  it("deduplicates entity notifications before ON CONFLICT", () => {
    const sql = source("supabase/migrations/20260921094500_action_center_refresh_core_6.sql");
    expect(sql).toContain("action_candidates as materialized");
    expect(sql).toContain("select distinct on (domain, entity_type, entity_id) *");
    expect(sql).toContain("priority desc");
  });

  it("keeps the refresh RPC service-only", () => {
    const sql = source("supabase/migrations/20260921094500_action_center_refresh_core_6.sql");
    expect(sql).toContain("revoke all on function public.refresh_operational_notifications_atomic(uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.refresh_operational_notifications_atomic(uuid) to service_role");
  });
});
