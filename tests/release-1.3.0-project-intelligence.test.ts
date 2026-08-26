import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260826090000_project_intelligence_130.sql");
const followup = read("supabase/migrations/20260826091000_project_intelligence_130_provenance_events.sql");
const hardening = read("supabase/migrations/20260826093000_project_intelligence_130_security_hardening.sql");
const documentationPage = read("app/workspace/projects/[projectId]/documentation/page.tsx");
const costPage = read("app/workspace/projects/[projectId]/cost-estimate/page.tsx");
const requestsPage = read("app/workspace/projects/[projectId]/requests/page.tsx");
const brainPage = read("app/workspace/projects/[projectId]/brain/page.tsx");
const dashboard = read("components/projects/project-action-preview.tsx");
const data = read("lib/data/project-intelligence-130.ts");

describe("Project Octopus 1.3.0 — ten Project Intelligence capabilities", () => {
  it("1. exposes the complete document AI processing state with explanation and retry", () => {
    expect(migration).toContain("document_processing_state_v");
    expect(migration).toContain("processing_stage");
    expect(migration).toContain("ai_explanation");
    expect(migration).toContain("retry_available");
    expect(documentationPage).toContain("ProjectDocumentIntelligence130");
    const intelligence = read("components/projects/project-document-intelligence-130.tsx");
    const retry = read("components/projects/document-retry-button-130.tsx");
    expect(intelligence).toContain("DocumentRetryButton130");
    expect(retry).toContain("Ponów analizę");
    expect(retry).toContain('/api/brain/retry');
  });

  it("2. tracks ZIP/folder packages as aggregate jobs", () => {
    expect(migration).toContain("document_package_progress_v");
    expect(migration).toContain("completed_count");
    expect(migration).toContain("attention_count");
    expect(migration).toContain("error_count");
    expect(data).toContain("DocumentPackageProgress130");
  });

  it("3. creates AI review exceptions for confidence below 70 percent", () => {
    expect(migration).toContain("ai_review_exceptions_v");
    expect(migration).toContain("<0.70");
    expect(read("components/projects/project-document-intelligence-130.tsx")).toContain("AI potrzebuje decyzji");
  });

  it("4. preserves provenance from module entity to source document and revision", () => {
    expect(migration).toContain("entity_source_links");
    expect(migration).toContain("project_provenance_v");
    expect(followup).toContain("sync_entity_source_link");
    expect(read("components/projects/project-document-intelligence-130.tsx")).toContain("Proweniencja: dokument → dane → moduł");
  });

  it("5. detects document revision families and links previous versions", () => {
    expect(migration).toContain("normalize_revision_family");
    expect(migration).toContain("revision_candidate_id");
    expect(migration).toContain("replaces_version_id");
    expect(migration).toContain("document_revision_control_v");
  });

  it("6. maps detected changes to affected investment modules", () => {
    expect(migration).toContain("assign_change_impact_modules");
    for (const module of ["boq", "material_requests", "warehouse", "schedule", "protocols", "tasks", "finance", "documentation"]) {
      expect(migration).toContain(`'${module}'`);
    }
    expect(read("components/projects/project-document-intelligence-130.tsx")).toContain("Analiza wpływu zmian");
  });

  it("7. reconciles BOQ with purchase, issue, installation, acceptance and invoicing", () => {
    expect(migration).toContain("boq_reality_v");
    for (const field of ["purchased_quantity", "issued_quantity", "installed_quantity", "accepted_quantity", "invoiced_quantity", "remaining_quantity", "overrun_quantity"]) {
      expect(migration).toContain(field);
    }
    expect(costPage).toContain("BoqRealityPanel130");
  });

  it("8. makes material requests an actionable AI-to-delivery workflow", () => {
    expect(migration).toContain("material_request_workflow_v");
    expect(migration).toContain("material_request_gaps_v");
    expect(followup).toContain("material_request_events");
    expect(requestsPage).toContain("MaterialRequestIntelligence130");
    expect(read("components/projects/material-gap-action-130.tsx")).toContain('action: "save"');
  });

  it("9. upgrades Brain with latest facts, conflicts, history and exact source context", () => {
    expect(migration).toContain("project_fact_versions");
    expect(migration).toContain("brain_fact_latest_v");
    expect(migration).toContain("brain_fact_conflicts_v");
    expect(brainPage).toContain("BrainIntelligence130");
    expect(read("components/projects/brain-intelligence-130.tsx")).toContain("Fakty z wersją, źródłem i konfliktem");
  });

  it("10. adds prioritized daily Project Intelligence to the investment dashboard", () => {
    expect(migration).toContain("project_intelligence_actions_v");
    expect(data).toContain("getProjectTodayIntelligence130");
    expect(dashboard).toContain("ProjectTodayIntelligence130");
    expect(read("components/projects/project-today-intelligence-130.tsx")).toContain("Co powinienem zrobić dzisiaj?");
  });

  it("hardens the 1.3.0 database surface", () => {
    expect(hardening).toContain("security_invoker = true");
    expect(hardening).toContain("revoke execute on function public.capture_processing_job_event()");
    expect(hardening).toContain("document_processing_events_member_insert");
    expect(hardening).toContain("project_fact_versions_source_reference_fk_idx");
  });
});
