import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchesImportManifest, fullyUploadedImport, normalizeImportSha256, type StoredImportManifestItem, type ImportManifestFile } from "../lib/documents/import-manifest-integrity";
import { stableSessionUuid, matchesPersistedImportVersion } from "../lib/documents/import-session-identities";
import { PIPELINE_STAGES, summarizePipelineStages, type PipelineStageStatus } from "../lib/documents/pipeline-stage-state";
import { safeProjectRoutingTarget, type ProjectMatchDecision } from "../lib/ai/project-matcher";

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

  it("reads KSeF inbox timestamps using the live database received_at column", () => {
    const finance = source("lib/data/finance-control-tower.ts");
    expect(finance).toContain('.from("business_inbox_items").select("id,status,received_at")');
    expect(finance).toContain('.order("received_at", { ascending: false })');
    expect(finance).toContain("ksefRows[0]?.received_at");
    expect(finance).not.toContain('.from("business_inbox_items").select("id,status,created_at")');
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

  it("runs the same invoice quality, finance AI and accounting checks on all AI paths", () => {
    const common = source("lib/finance/document-invoice-finalization.ts");
    const immediate = source("app/api/brain/process/route.ts");
    const worker = source("app/api/brain/worker/route.ts");
    const retry = source("app/api/brain/retry/route.ts");
    expect(common).toContain("export async function runInvoiceIntakeChecks");
    expect(common).toContain("assessDocumentInvoiceReadiness(input)");
    expect(common).toContain("runAccountingCopilotForDocument");
    for (const route of [immediate, worker, retry]) {
      expect(route).toContain("runInvoiceIntakeChecks");
    }
    expect(worker).toContain('event_type: "document.invoice_finalization_failed"');
    expect(worker).toContain("worker.document_autopilot_partial");
    expect(immediate).toContain("autopilot.failed > 0");
    expect(common).toContain('ai_status: "review"');
  });

  it("keeps a 100-document import resumable without delaying each upload on Gemini", () => {
    const upload = source("components/documents/document-upload.tsx");
    const session = source("app/api/documents/import-session/route.ts");
    expect(upload).toContain("selectedFiles.length > 1");
    expect(upload).toContain("if (deferAnalysis)");
    expect(upload).toContain("alreadyUploaded.has(index + 1)");
    expect(session).toContain("sameManifest");
    expect(session).toContain("resumed: true");
    expect(session).toContain(".is(\"document_version_id\", null)");
    const uploadUrl = source("app/api/storage/upload-url/route.ts");
    expect(uploadUrl).toContain("stableSessionUuid(workspace.id, importSessionItemId");
    expect(uploadUrl).toContain("importItem.file_name !== fileName");
    expect(uploadUrl).toContain("importItem.file_size_bytes");
  });

  it("holds invoice PZ receipts for reconciliation with WZ, PZ and MM evidence", () => {
    const migration = source("supabase/migrations/20261028114000_invoice_stock_reconciliation_gate.sql");
    expect(migration).toContain("create or replace function public.auto_receive_purchase_invoice_atomic");
    expect(migration).toContain("invoice_warehouse_reconciliation_required");
    expect(migration).toContain("'PZ','WZ','MM'");
    expect(migration).toContain("'stockChanged',false");
    expect(migration).not.toContain("approve_stock_movement_atomic(");
    expect(migration).not.toContain("auto_receive_purchase_invoice_unguarded_atomic(");
  });

  it("checks exact cross-batch document hashes inside one workspace before automatic routing", () => {
    const autopilot = source("lib/ai/document-autopilot.ts");
    const sql = source("supabase/migrations/20261028121500_guard_cross_batch_duplicate_content.sql");
    const gate = source("lib/documents/exact-duplicate-guard.ts");
    expect(autopilot).toContain("findExistingExactDuplicate");
    expect(gate).toContain('find_document_sha256_duplicate_20261028');
    expect(autopilot).toContain('event_type: "document.duplicate_content_candidate"');
    expect(autopilot).toContain("automaticMaterializationBlocked: true");
    expect(autopilot).toContain('ai_status: "review"');
    expect(sql).toContain("d.workspace_id=p_workspace_id");
    expect(sql).toContain("dv.sha256=p_sha256");
    expect(sql).toContain("document_id <> p_document_id");
    expect(sql).toContain("grant execute on function public.find_document_sha256_duplicate_20261028");
    expect(sql).toContain("to service_role");
  });

  it("shows duplicate evidence with the batch report instead of silently accepting repeated files", () => {
    const api = source("app/api/documents/import-session/route.ts");
    const ui = source("components/documents/document-upload.tsx");
    expect(api).toContain('event_type","document.duplicate_content_candidate"');
    expect(api).toContain("duplicateOfDocumentId");
    expect(api).toContain("counts.duplicates");
    expect(ui).toContain("batchSummary.counts.duplicates");
    expect(ui).toContain("Duplikat do sprawdzenia:");
  });

  it("prevents invoice materialization after exact-content duplicate detection", () => {
    const worker = source("app/api/brain/worker/route.ts");
    const direct = source("app/api/brain/process/route.ts");
    const retry = source("app/api/brain/retry/route.ts");
    expect(worker).toContain('autopilot.failed > 0');
    expect(direct).toContain("autopilot.failed === 0");
    expect(retry).toContain("autopilot.failed === 0");
  });

  it("requires at least two independent AI provider families and hard evidence to merge duplicates", () => {
    const council = source("lib/ai/multi-ai-core.ts");
    const policy = source("lib/ai/unified-document-ai-policy.ts");
    const base = source("lib/ai/unified-document-copilot.ts");
    expect(council).toContain("providerFamilies.size >= 2");
    expect(council).toContain("Nie udało się zapisać audytu konsensusu AI");
    expect(council).not.toContain("persistRun(workspaceId, reviewId, base.id, vote, promptHash).catch(() => undefined)");
    expect(council).toContain('vote.recommendation === "duplicate_same"');
    expect(council).toContain("base.hardDuplicateEvidence && providerQuorum");
    expect(council).toContain('recommendation: "manual_review"');
    expect(policy).toContain("input.hardDuplicateEvidence");
    expect(base).toContain("all.taxExact === true");
    expect(base).not.toContain("(all.taxExact === true || all.nameExact === true)");
  });

  it("routes uncertain invoice identities to human review rather than blind auto-merge", () => {
    const sql = source("supabase/migrations/20261028121500_guard_cross_batch_duplicate_content.sql");
    expect(sql).toContain("from scored where score>=.55");
    expect(sql).toContain("'autoMerge',v_hard and v_score>=.94");
    expect(sql).toContain("'requiresReview',not (v_hard and v_score>=.94)");
  });

  it("flags repeated warehouse document identities and disables automatic physical-stock posting", () => {
    const sql = source("supabase/migrations/20261028123000_warehouse_duplicate_hold_and_stock_gate.sql");
    expect(sql).toContain("manual_reconciliation_required_20261028");
    expect(sql).toContain("new.status:='waiting'");
    expect(sql).toContain("duplicateCandidateReviewId");
    expect(sql).toContain("w.workspace_id=new.workspace_id");
    expect(sql).toContain("w.document_id<>new.document_id");
  });

  it("queries for duplicate files before choosing the first matching version", () => {
    const migration = source("supabase/migrations/20261028132000_cross_import_sha256_lookup_correctness.sql");
    const query = migration.split("as $body$")[1]?.split("$body$")[0] ?? "";
    const exclusion = query.indexOf("dv.document_id is distinct from p_document_id");
    const ordering = query.indexOf("order by coalesce");
    expect(exclusion).toBeGreaterThanOrEqual(0);
    expect(exclusion).toBeLessThan(ordering);
    expect(migration).toContain("document_versions_sha256_cross_import_idx");
    expect(migration).toContain("to service_role");
  });

  it("holds low-confidence or unassigned investment documents rather than silently publishing proposals", () => {
    const pilot = source("lib/ai/document-autopilot.ts");
    expect(pilot).toContain("classificationConfidence");
    expect(pilot).toContain("Number(classificationConfidence) < 0.82");
    expect(pilot).toContain("unassignedProjectProposals");
    expect(pilot).toContain("noUncertainAutomaticPublication: true");
    expect(pilot).toContain("businessDocumentProcessed = result?.skipped !== true && businessDocumentCount > 0");
    expect(pilot).toContain('errors.push("AI rozpoznało dokument finansowo-magazynowy');
  });

  it("applies exact duplicate guards before investment enrichment on every processing entry point", () => {
    const worker = source("app/api/brain/worker/route.ts");
    const direct = source("app/api/brain/process/route.ts");
    const retry = source("app/api/brain/retry/route.ts");
    for (const path of [worker, direct, retry]) {
      const guard = path.indexOf("await findExistingExactDuplicate");
      const route = path.indexOf("await enrichDocumentWithInvestmentRouting");
      expect(guard).toBeGreaterThanOrEqual(0);
      expect(guard).toBeLessThan(route);
    }
    expect(worker).toContain("!duplicate");
    expect(worker).toContain("sourceVersion.project_id ?? analysis.proposedProjectId ?? null");
    expect(worker).toContain("routingProjectId && actorId && analysis.confidence >= 0.82");
    expect(direct).toContain("!exactDuplicate");
    expect(retry).toContain("!exactDuplicate");
    expect(worker).toContain('autopilot.status !== "applied"');
    expect(retry).toContain('status: "review"');
  });

  it("does not hide finance AI failures and waits for review before final accounting readiness", () => {
    const pipeline = source("lib/finance/document-invoice-finalization.ts");
    expect(pipeline).toContain("if (financeAi.failed > 0)");
    expect(pipeline).toContain("runAccountingCopilotForDocument");
    expect(pipeline.indexOf("const financeAi = await analyzeInvoiceReviews"))
      .toBeLessThan(pipeline.indexOf("const accounting = await runAccountingCopilotForDocument"));
    expect(pipeline).toContain("item.requiresReview || item.warehouseReceipt?.requiresHumanReview");
    expect(pipeline).toContain("financeAi.requiresHuman > 0");
    expect(pipeline).toContain("accounting.some((item) => item.needsReview)");
  });

  it("resumes a synthetic 100-file batch only when all SHA-256 digests match", () => {
    const manifest: ImportManifestFile[] = Array.from({ length: 100 }, (_, index) => ({
      relativePath: `Finanse/Faktury/2026/faktura-${index + 1}.pdf`,
      fileName: `faktura-${index + 1}.pdf`,
      fileSize: 1024 + index,
      sha256: (index + 1).toString(16).padStart(64, "0")
    }));
    const stored: StoredImportManifestItem[] = manifest.map((file, index) => ({
      ordinal: index + 1,
      relative_path: file.relativePath,
      file_name: file.fileName,
      file_size_bytes: file.fileSize,
      file_sha256: file.sha256,
      upload_status: index < 60 ? "uploaded" : "pending",
      document_id: index < 60 ? `doc-${index}` : null,
      document_version_id: index < 60 ? `version-${index}` : null
    }));
    expect(matchesImportManifest(stored, manifest)).toBe(true);
    expect(fullyUploadedImport(stored, 100)).toBe(false);
    expect(stored.filter((item) => item.upload_status === "uploaded")).toHaveLength(60);

    // Same name, path and length but different bytes MUST NOT resume.
    const altered = manifest.map((file, index) => index === 57
      ? { ...file, sha256: "f".repeat(64) } : file);
    expect(matchesImportManifest(stored, altered)).toBe(false);
    expect(matchesImportManifest(stored, [...manifest].reverse())).toBe(false);
    expect(matchesImportManifest(stored.slice(0, 99), manifest)).toBe(false);
    expect(matchesImportManifest(stored.map((file, index) => index === 7
      ? { ...file, file_sha256: null } : file), manifest)).toBe(false);

    const complete = stored.map((item) => ({
      ...item, upload_status: "uploaded",
      document_id: item.document_id ?? `doc-${item.ordinal}`,
      document_version_id: item.document_version_id ?? `version-${item.ordinal}`
    }));
    expect(fullyUploadedImport(complete, 100)).toBe(true);
    expect(fullyUploadedImport(complete.slice(0, 99), 100)).toBe(false);
    expect(fullyUploadedImport(complete.map((item, index) =>
      index === 42 ? { ...item, document_version_id: null } : item), 100)).toBe(false);
    expect(normalizeImportSha256("A".repeat(64))).toBe("a".repeat(64));
    expect(normalizeImportSha256("bad-hash")).toBeNull();
  });

  it("recovers persisted upload identities after losing the browser connection", () => {
    const workspaceId = "7bed89a1-57b4-484e-aa98-71dbba72a19f";
    for (let i = 0; i < 100; i++) {
      const item = {
        id: `item-${i}`,
        file_sha256: (i + 1).toString(16).padStart(64, "0"),
        file_name: `invoice-${i}.pdf`,
        file_size_bytes: 2048 + i
      };
      const version = {
        id: stableSessionUuid(workspaceId, item.id, "version"),
        document_id: stableSessionUuid(workspaceId, item.id, "document"),
        sha256: item.file_sha256,
        file_name: item.file_name,
        file_size_bytes: item.file_size_bytes
      };
      expect(matchesPersistedImportVersion(workspaceId, item, version)).toBe(true);
      expect(stableSessionUuid(workspaceId, item.id, "version"))
        .toBe(stableSessionUuid(workspaceId, item.id, "version"));
      expect(matchesPersistedImportVersion(workspaceId, item, {
        ...version, sha256: "a".repeat(64)
      })).toBe(false);
      expect(matchesPersistedImportVersion(workspaceId, item, {
        ...version, document_id: stableSessionUuid(workspaceId, `other-${i}`, "document")
      })).toBe(false);
    }
    const route = source("app/api/documents/import-session/route.ts");
    expect(route).toContain("matchesPersistedImportVersion(workspace.id, item, version)");
    expect(route).toContain(".is(\"document_version_id\", null)");
    expect(route).toContain("if ((saved ?? []).length)");
  });

  it("enforces SHA-256 from batch creation to upload URL, completion and finalization", () => {
    const upload = source("components/documents/document-upload.tsx");
    const session = source("app/api/documents/import-session/route.ts");
    const url = source("app/api/storage/upload-url/route.ts");
    const complete = source("app/api/storage/complete/route.ts");
    expect(upload).toContain("sha256: fileDigests.get(index + 1)");
    expect(upload).toContain("Sprawdzanie SHA-256 pliku");
    expect(upload).toContain("precomputedSha256");
    expect(session).toContain("matchesImportManifest(previousItems");
    expect(session).toContain("fullyUploadedImport(finalItems ?? [], session.expected_files)");
    expect(url).toContain("normalizeImportSha256(body.sha256) !== importItem.file_sha256");
    expect(complete).toContain("sessionItem.file_sha256 !== normalizeSha256(body.sha256)");
    expect(complete).toContain("sessionItem.document_version_id");
  });

  it("polls batch progress only in visible, non-uploading tabs without overlapping requests", () => {
    const upload = source("components/documents/document-upload.tsx");
    expect(upload).toContain("document.visibilityState !== \"visible\"");
    expect(upload).toContain("window.setInterval(refreshVisible, 12000)");
    expect(upload).toContain("reportRefreshInFlightRef.current");
    expect(upload).toContain("if (!workspaceId || !batchSummaryId || isUploading");
    expect(upload).toContain('document.addEventListener("visibilitychange", refreshVisible)');
    expect(upload).toContain('document.removeEventListener("visibilitychange", refreshVisible)');
    expect(upload).toContain("const byId = new Map(documents.map");
    expect(upload).not.toContain("setInterval(() => { void refreshImportSession(batchSummaryId).catch(() => undefined); }, 5000)");
  });

  it("fetches compact AI document types rather than full extraction payloads for batch reports", () => {
    const api = source("app/api/documents/import-session/route.ts");
    const migration = source("supabase/migrations/20261028144500_import_report_slim_read_model.sql");
    expect(api).toContain('get_import_document_type_labels_20261028');
    expect(api).toContain("extraction?.document_types ?? []");
    expect(api).toContain("documentsResult, classificationsResult, extractionsResult");
    expect(api).not.toContain('.select("document_id,document_version_id,payload,created_at")');
    expect(migration).toContain("distinct on (de.document_version_id)");
    expect(migration).toContain("document_extractions_import_report_idx_20261028");
    expect(migration).toContain("de.workspace_id = p_workspace_id");
    expect(migration).toContain("grant execute on function public.get_import_document_type_labels_20261028");
    expect(migration).toContain("to service_role");
  });

  it("loads Finance projects alongside the first query wave and groups allocations in place", () => {
    const finance = source("lib/data/finance-control-tower.ts");
    expect(finance).toContain("inboxResult, procurementResult, projectResult] = await Promise.all");
    expect(finance).toContain('db.from("projects").select("id,name").eq("workspace_id", workspaceId).limit(500)');
    expect(finance).toContain("const [invoiceResult, txResult, lineResult, allocationResult] = await Promise.all");
    expect(finance).toContain("if (existing) existing.push(row)");
    expect(finance).not.toContain("allocations.set(key, [...(allocations.get(key) ?? []), row])");
  });

  it("does not claim full success for 100 extracted documents before routing, accounting and reconciliation", () => {
    const complete = PIPELINE_STAGES.map(stage => ({stage,status:"complete" as PipelineStageStatus}));
    const skipped = PIPELINE_STAGES.map(stage => ({
      stage,status:stage==="extract"||stage==="route"?"complete" as PipelineStageStatus:"not_applicable" as PipelineStageStatus
    }));
    for(let index=0;index<100;index++) {
      expect(summarizePipelineStages(complete)).toBe("complete");
      expect(summarizePipelineStages(skipped)).toBe("complete");
      expect(summarizePipelineStages(complete.slice(0,1))).toBe("pending");
      expect(summarizePipelineStages(complete.map((s,i)=>i===5?{...s,status:"review"}:s))).toBe("review");
      expect(summarizePipelineStages(complete.map((s,i)=>i===4?{...s,status:"error"}:s))).toBe("error");
    }
  });

  it("prevents publishing to a guessed investment below the safety threshold", () => {
    const matched:ProjectMatchDecision={status:"matched",project:{id:"project-1",name:"Wysoka"},
      score:0.91,runnerUpScore:0.2,margin:0.71,reason:"exact contract",
      evidence:[{type:"contract",value:"WYS-123"}],alternatives:[]};
    expect(safeProjectRoutingTarget(null,"project-1",matched)).toBe("project-1");
    expect(safeProjectRoutingTarget("chosen-project","project-1",matched)).toBe("chosen-project");
    expect(safeProjectRoutingTarget(null,"project-1",{...matched,score:0.79})).toBeNull();
    expect(safeProjectRoutingTarget(null,"project-2",matched)).toBeNull();
    expect(safeProjectRoutingTarget(null,"project-1",{...matched,status:"ambiguous"})).toBeNull();
    for(const route of ["app/api/brain/worker/route.ts","app/api/brain/process/route.ts","app/api/brain/retry/route.ts"]){
      const code=source(route);
      expect(code).toContain("safeProjectRoutingTarget(");
      expect(code).toContain("recordPipelineOutcome(");
    }
  });

  it("routes independently of Wrzutnia and records the full stage outcome in every entry point", () => {
    const process = source("lib/ai/process-document.ts");
    const specialist = source("lib/ai/gemini-warehouse-document.ts");
    const worker = source("app/api/brain/worker/route.ts");
    const direct = source("app/api/brain/process/route.ts");
    const retry = source("app/api/brain/retry/route.ts");
    const summary = source("app/api/documents/import-session/route.ts");
    expect(process).toContain("mustUseStructuredSpecialist");
    expect(process).toContain("analyzeWarehouseDocumentWithGemini");
    expect(specialist).toContain("businessDocuments");
    for(const entry of [worker,direct,retry]) expect(entry).toContain("recordPipelineOutcome");
    expect(summary).toContain("summarizePipelineStages(stages)");
    expect(summary).toContain("document_pipeline_stages");
    const ui = source("components/documents/document-upload.tsx");
    expect(ui).toContain("Dokumenty wymagające kontroli — zobacz etapy");
    expect(ui).toContain("retryFinanceStage");
    expect(ui).toContain("await refreshImportSession(batchSummary.id)");
    expect(retry).toContain('if (body.stage)');
    expect(retry).toContain("retry_document_processing_atomic");
    expect(retry.indexOf("if (body.stage)")).toBeLessThan(retry.indexOf("retry_document_processing_atomic"));
  });

  it("evaluates more than four AI decisions and persists provider evidence", () => {
    const finance = source("lib/finance/document-invoice-finalization.ts");
    const council = source("lib/ai/multi-ai-core.ts");
    expect(finance).not.toContain(".slice(0, 4)");
    expect(finance).toContain("for (let offset = 0; offset < reviewIds.length; offset += 2)");
    expect(finance).toContain("proposeInvoiceWarehouseReconciliation");
    expect(council).toContain("providerFamilies.size >= 2");
  });

  it("persists read-only WZ/PZ/MM line matching and never posts quantity on its own", () => {
    const sql = source("supabase/migrations/20261030120000_document_pipeline_stages_and_reconciliation.sql");
    const reconcile = source("lib/finance/warehouse-reconciliation.ts");
    expect(sql).toContain("document_pipeline_stages");
    expect(sql).toContain("document_warehouse_reconciliations");
    expect(sql).toContain("stock_item_id=wal.candidate_stock_item_id");
    expect(sql).toContain("il.supplier_sku");
    expect(sql).toContain("quantityAgrees");
    expect(sql).not.toContain("approve_stock_movement_atomic");
    expect(reconcile).toContain('status:"review"');
    expect(reconcile).toContain("ignoreDuplicates:true");
    expect(reconcile).toContain("requiresHumanReview:candidates.length>0");
    expect(reconcile).toContain("refreshWarehouseDocumentReconciliations");
    expect(source("lib/ai/document-autopilot.ts")).toContain(
      "refreshWarehouseDocumentReconciliations(input.workspaceId,input.documentId)"
    );
  });

  it("runs the warehouse overview data reads concurrently instead of in waterfalls", () => {
    const warehouse = source("lib/data/warehouse-market-400.ts");
    expect(warehouse).toContain("const [base, ai, forecastsResult, readinessResult, recommendationsResult, pendingMovementsResult] = await Promise.all");
  });
});
