import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261121153000_project_intelligence_event_graph_rfi_contract.sql", "utf8"
);
const api = readFileSync("app/api/projects/intelligence/route.ts", "utf8");

describe("Octopus integrated project intelligence - no new visual surface", () => {
  it("connects real proposals, canonical invoices, warehouse movements and document revisions", () => {
    for (const source of [
      "public.document_module_proposals",
      "public.invoices",
      "public.stock_movements",
      "public.document_change_impacts",
      "p.source_locator", "p.source_quote", "coalesce(p.published_entity_id,p.id)"
    ]) expect(migration).toContain(source);
  });

  it("scopes each incremental refresh to one verified company/project/version", () => {
    expect(migration).toContain("p_workspace_id uuid, p_version_id uuid");
    expect(migration).toContain("where v.id=p_version_id and d.workspace_id=p_workspace_id");
    expect(migration).toContain("where p.workspace_id=p_workspace_id");
    expect(migration).toContain("create trigger project_intelligence_route_event");
    expect(migration).toContain("after insert or update of status on public.document_pipeline_stages");
    expect(migration).toContain("create trigger project_intelligence_invoice_event");
    expect(migration).toContain("create trigger project_intelligence_warehouse_event");
    expect(migration).toContain("on conflict(workspace_id,event_key) do update");
  });

  it("drafts RFI from real high-risk revision evidence, without automatic sending", () => {
    expect(migration).toContain("'rfi_draft'");
    expect(migration).toContain("ci.risk_level in ('high','critical')");
    expect(migration).toContain("ci.status not in ('approved','rejected')");
    expect(migration).toContain("ci.evidence");
    expect(api).toContain("sentExternally: false");
  });

  it("does not invent contractual risk without a contract document and source impact", () => {
    expect(migration).toContain("'contract_risk'");
    expect(migration).toContain("lower(coalesce(v_document.category,'')) in ('contract','agreement','umowa')");
    expect(migration).toContain("ci.document_id=v_document.id");
  });

  it("protects intelligence read model, reviews and event writes by company membership", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.project_intelligence_edges");
    expect(migration).toContain("revoke all on public.project_intelligence_findings");
    expect(migration).toContain("revoke all on function public.refresh_project_intelligence_for_version(uuid,uuid)");
    expect(api).toContain("getRequestUser");
    expect(api).toContain("getWorkspaceForUser");
    expect(api).toContain("hasDomainAccess");
    expect(api).toContain('.eq("workspace_id", workspace.id)');
    expect(api).toContain('.eq("project_id", projectId)');
  });

  it("keeps review decisions separate from sending and posting", () => {
    expect(api).toContain('decision = body.decision');
    expect(api).toContain('.eq("status", "pending")');
    expect(api).not.toContain("fetch(");
    expect(api).not.toContain("sendMail");
    expect(migration).not.toContain("update public.invoices");
    expect(migration).not.toContain("update public.financial_allocations");
  });
});
