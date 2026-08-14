import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseMigration = readFileSync("supabase/migrations/20260811130000_project_octopus_mvp.sql", "utf8");
const foundationFix = readFileSync(
  "supabase/migrations/20260812100000_project_octopus_foundation_fix.sql",
  "utf8"
);
const operatingSystem = readFileSync(
  "supabase/migrations/20260814090000_octopus_operating_system.sql",
  "utf8"
);
const executionLayer = readFileSync(
  "supabase/migrations/20260814130000_octopus_execution_layer.sql",
  "utf8"
);
const atomicEstimateApproval = readFileSync(
  "supabase/migrations/20260814170000_atomic_estimate_approval.sql",
  "utf8"
);
const domainAccessHardening = readFileSync(
  "supabase/migrations/20260814180000_domain_access_hardening.sql",
  "utf8"
);

describe("Supabase migration contract", () => {
  it("uses the project profile columns expected by the application", () => {
    expect(baseMigration).toContain("value_text text");
    expect(baseMigration).toContain("value_json jsonb");
    expect(baseMigration).not.toContain("title text not null,\n  value text");
  });

  it("installs the atomic upload function and schema marker", () => {
    expect(foundationFix).toContain("function public.complete_document_upload");
    expect(foundationFix).toContain("20260812_foundation_fix");
    expect(foundationFix).toContain("pg_advisory_xact_lock");
  });

  it("does not expose global AI runs to every authenticated user", () => {
    expect(foundationFix).toContain("project_id is null and created_by = auth.uid()");
  });

  it("installs the cross-module document and AI operating core", () => {
    expect(operatingSystem).toContain("20260814_octopus_os");
    expect(operatingSystem).toContain("alter table public.documents alter column project_id drop not null");
    expect(operatingSystem).toContain("create table if not exists public.entity_links");
    expect(operatingSystem).toContain("create table if not exists public.processing_jobs");
    expect(operatingSystem).toContain("create table if not exists public.document_intakes");
    expect(operatingSystem).toContain("create table if not exists public.invoices");
    expect(operatingSystem).toContain("create table if not exists public.employees");
    expect(operatingSystem).toContain("create table if not exists public.stock_movements");
    expect(operatingSystem).toContain("create table if not exists public.vehicles");
    expect(operatingSystem).toContain("create table if not exists public.templates");
    expect(operatingSystem).toContain("create table if not exists public.report_snapshots");
    expect(operatingSystem).toContain("alter table public.progress_entries add column if not exists workspace_id");
    expect(operatingSystem).toContain("set workspace_id = p.workspace_id");
    expect(operatingSystem).toContain("alter table public.%I add column workspace_id");
  });

  it("enqueues every completed document version for idempotent processing", () => {
    expect(operatingSystem).toContain("'document-pipeline:' || p_version_id::text");
    expect(operatingSystem).toContain("on conflict (job_key) do nothing");
    expect(operatingSystem).toContain("p_project_id is not null and not exists");
  });

  it("installs the execution layer for search, review and the full project flow", () => {
    expect(executionLayer).toContain("20260814_execution_layer");
    expect(executionLayer).toContain("claim_next_processing_job");
    expect(executionLayer).toContain("search_octopus");
    expect(executionLayer).toContain("create table if not exists public.estimate_imports");
    expect(executionLayer).toContain("create table if not exists public.evidence_requirements");
    expect(executionLayer).toContain("create table if not exists public.closeout_requirements");
    expect(executionLayer).toContain("create table if not exists public.ksef_inbox_items");
  });

  it("approves a cost estimate, WBS and schedule draft in one transaction", () => {
    expect(atomicEstimateApproval).toContain("function public.approve_estimate_import_atomic");
    expect(atomicEstimateApproval).toContain("pg_advisory_xact_lock");
    expect(atomicEstimateApproval).toContain("insert into public.boq_versions");
    expect(atomicEstimateApproval).toContain("insert into public.schedule_activities");
    expect(atomicEstimateApproval).toContain("20260814_atomic_estimate_approval");
  });

  it("enforces finance, HR and document domains below the application layer", () => {
    expect(domainAccessHardening).toContain("function public.has_domain_access");
    expect(domainAccessHardening).toContain("function public.document_domain");
    expect(domainAccessHardening).toContain("document domain members can read");
    expect(domainAccessHardening).toContain("users can read own notifications");
    expect(domainAccessHardening).toContain("20260814_domain_access_hardening");
  });
});
