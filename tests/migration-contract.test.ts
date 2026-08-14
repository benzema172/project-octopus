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
});

