import "server-only";

import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseSecureZip } from "@/lib/documents/secure-zip";
import { scanDocumentBytes, type MalwareScanResult } from "@/lib/documents/malware-scan";
import { normalizeDocumentCategory, type DocumentCategory } from "@/lib/documents/classification";
import { getR2Config } from "@/lib/env";
import { createR2Client } from "@/lib/r2/client";
import { validateFileSignature } from "@/lib/r2/file-signature";
import { inferDocumentCategory, sanitizeFileName, validateUploadFile } from "@/lib/r2/sanitize";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { ProjectMatchDecision } from "@/lib/ai/project-matcher";

type ParentVersion = {
  id: string;
  document_id: string;
  project_id: string | null;
  file_name: string;
  r2_bucket: string;
  r2_object_key: string;
};

type PackageRow = {
  id: string;
  status: string;
  entry_count: number;
  accepted_count: number;
  rejected_count: number;
  manifest: Array<Record<string, unknown>> | null;
};

export type PackageDocumentAnalysis = {
  category: DocumentCategory;
  subcategory: string;
  confidence: number;
  summary: string;
  projectHint: string;
  installations: string[];
  workStages: string[];
  requiredProtocols: string[];
  requiredApplications: string[];
  searchPassages: string[];
  businessDocument: {
    documentType: string;
    documentNumber: string;
    ksefNumber: string;
    purchaseOrderNumber: string;
    direction: string;
    issueDate: string;
    dueDate: string;
    supplierName: string;
    supplierTaxId: string;
    buyerName: string;
    buyerTaxId: string;
    currency: string;
    netAmount: number;
    taxAmount: number;
    grossAmount: number;
    lines: [];
  };
  boqItems: [];
  facts: [];
  warnings: string[];
  aiCategory: DocumentCategory;
  effectiveCategory: DocumentCategory;
  categoryLocked: boolean;
  proposedProjectId: string | null;
  projectMatch: ProjectMatchDecision | null;
  package: {
    id: string;
    accepted: number;
    rejected: number;
    queuedVersionIds: string[];
  };
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  xml: "application/xml",
  txt: "text/plain",
  json: "application/json",
  md: "text/markdown",
  zip: "application/zip"
};

function mimeFor(fileName: string) {
  return MIME_BY_EXTENSION[fileName.toLowerCase().split(".").at(-1) ?? ""] ?? "application/octet-stream";
}

function emptyBusinessDocument(): PackageDocumentAnalysis["businessDocument"] {
  return {
    documentType: "", documentNumber: "", ksefNumber: "", purchaseOrderNumber: "", direction: "purchase",
    issueDate: "", dueDate: "", supplierName: "", supplierTaxId: "", buyerName: "", buyerTaxId: "",
    currency: "PLN", netAmount: 0, taxAmount: 0, grossAmount: 0, lines: []
  };
}

function objectKeyForChild(input: { workspaceId: string; projectId: string | null; documentId: string; versionId: string; fileName: string }) {
  const context = input.projectId ? `projects/${input.projectId}` : "company";
  return `workspaces/${input.workspaceId}/${context}/documents/${input.documentId}/versions/${input.versionId}/${sanitizeFileName(input.fileName)}`;
}

export async function processDocumentPackage(input: {
  workspaceId: string;
  parent: ParentVersion;
  bytes: Buffer;
  userId?: string | null;
  parentSha256: string;
}): Promise<PackageDocumentAnalysis> {
  const db = createServiceSupabaseClient();
  const existingResult = await db.from("document_packages")
    .select("id,status,entry_count,accepted_count,rejected_count,manifest")
    .eq("parent_version_id", input.parent.id)
    .maybeSingle<PackageRow>();
  if (existingResult.error) throw new Error(`Nie udało się odczytać paczki: ${existingResult.error.message}`);
  if (existingResult.data?.status === "expanded") {
    const queued = (existingResult.data.manifest ?? [])
      .map((item) => typeof item.childVersionId === "string" ? item.childVersionId : null)
      .filter((value): value is string => Boolean(value));
    return packageAnalysis(existingResult.data.id, existingResult.data.accepted_count, existingResult.data.rejected_count, queued, [], input.parent.project_id);
  }

  const archive = parseSecureZip(input.bytes);
  const initialManifest = archive.entries.map((entry) => ({
    path: entry.path,
    compressedBytes: entry.compressedBytes,
    uncompressedBytes: entry.uncompressedBytes,
    sha256: entry.sha256,
    status: "queued"
  }));
  const { data: packageRow, error: packageError } = await db.from("document_packages").upsert({
    workspace_id: input.workspaceId,
    project_id: input.parent.project_id,
    parent_document_id: input.parent.document_id,
    parent_version_id: input.parent.id,
    status: "expanding",
    entry_count: archive.entries.length,
    total_uncompressed_bytes: archive.totalUncompressedBytes,
    manifest: initialManifest,
    security_report: { ...archive.security, ignoredEntries: archive.ignoredEntries, parentSha256: input.parentSha256 },
    created_by: input.userId ?? null,
    updated_at: new Date().toISOString()
  }, { onConflict: "parent_version_id" }).select("id").single<{ id: string }>();
  if (packageError || !packageRow) throw new Error(`Nie udało się utworzyć manifestu paczki: ${packageError?.message ?? "brak danych"}`);

  const r2Config = getR2Config();
  const r2 = createR2Client();
  const manifest: Array<Record<string, unknown>> = [];
  const queuedVersionIds: string[] = [];
  const warnings: string[] = [];
  let accepted = 0;
  let rejected = 0;

  for (const entry of archive.entries) {
    const mimeType = mimeFor(entry.fileName);
    const nestedArchive = entry.fileName.toLowerCase().endsWith(".zip");
    let validationError = nestedArchive
      ? "Zagnieżdżone archiwa ZIP są blokowane."
      : validateUploadFile(entry.fileName, mimeType, entry.uncompressedBytes)
        ?? validateFileSignature(entry.fileName, mimeType, entry.bytes.subarray(0, 4096));
    let malwareScan: MalwareScanResult | null = null;
    if (!validationError) {
      try {
        malwareScan = await scanDocumentBytes({ bytes: entry.bytes, fileName: entry.fileName, mimeType, sha256: entry.sha256 });
        if (malwareScan.status === "infected") validationError = `Skan malware odrzucił plik: ${malwareScan.threat ?? "wykryto zagrożenie"}.`;
      } catch (error) {
        validationError = error instanceof Error ? error.message : "Skan bezpieczeństwa pliku nie powiódł się.";
      }
    }
    if (validationError) {
      rejected += 1;
      warnings.push(`${entry.path}: ${validationError}`);
      await db.from("document_package_items").upsert({
        package_id: packageRow.id, workspace_id: input.workspaceId, project_id: input.parent.project_id,
        entry_path: entry.path, safe_file_name: sanitizeFileName(entry.fileName), mime_type: mimeType,
        compressed_bytes: entry.compressedBytes, uncompressed_bytes: entry.uncompressedBytes,
        compression_method: entry.compressionMethod, crc32: entry.crc32, sha256: entry.sha256,
        status: "rejected", error_message: validationError, updated_at: new Date().toISOString()
      }, { onConflict: "package_id,entry_path" });
      manifest.push({ path: entry.path, status: "rejected", error: validationError, sha256: entry.sha256, malwareScan });
      continue;
    }

    const documentId = randomUUID();
    const versionId = randomUUID();
    const objectKey = objectKeyForChild({
      workspaceId: input.workspaceId, projectId: input.parent.project_id,
      documentId, versionId, fileName: entry.fileName
    });
    let databaseCommitted = false;
    try {
      const stored = await r2.send(new PutObjectCommand({
        Bucket: r2Config.bucketName,
        Key: objectKey,
        Body: new Uint8Array(entry.bytes),
        ContentType: mimeType,
        ContentLength: entry.bytes.length,
        Metadata: { package: packageRow.id, parentversion: input.parent.id }
      }));
      const category = normalizeDocumentCategory(inferDocumentCategory(mimeType, entry.fileName)) ?? "other";
      const { data: completed, error: completeError } = await db.rpc("complete_document_upload_v2", {
        p_document_id: documentId,
        p_version_id: versionId,
        p_workspace_id: input.workspaceId,
        p_project_id: input.parent.project_id,
        p_file_name: entry.fileName,
        p_category: category,
        p_mime_type: mimeType,
        p_file_size_bytes: entry.bytes.length,
        p_r2_bucket: r2Config.bucketName,
        p_r2_object_key: objectKey,
        p_r2_etag: stored.ETag?.replace(/^"|"$/g, "") ?? null,
        p_sha256: entry.sha256,
        p_uploaded_by: input.userId ?? null,
        p_uploaded_at: new Date().toISOString(),
        p_category_locked: false
      }).single<{ document_id: string; version_id: string }>();
      if (completeError || !completed) throw new Error(completeError?.message ?? "brak zapisu dokumentu potomnego");
      databaseCommitted = true;

      const { error: scanPersistenceError } = await db.from("document_versions").update({
        malware_scan_status: malwareScan?.status ?? "unavailable",
        malware_scanned_at: new Date().toISOString(),
        malware_scan_metadata: malwareScan ?? { reason: "scanner_result_missing" }
      }).eq("id", versionId);
      if (scanPersistenceError) throw new Error(`Nie udało się zapisać skanu bezpieczeństwa pliku z paczki: ${scanPersistenceError.message}`);

      await db.from("document_intakes").update({
        channel: "package",
        source_external_key: `${input.parent.id}:${entry.path}`,
        source_metadata: { packageId: packageRow.id, parentDocumentId: input.parent.document_id, parentVersionId: input.parent.id, entryPath: entry.path, malwareScan }
      }).eq("document_id", documentId);
      await db.from("document_package_items").upsert({
        package_id: packageRow.id, workspace_id: input.workspaceId, project_id: input.parent.project_id,
        entry_path: entry.path, safe_file_name: sanitizeFileName(entry.fileName), mime_type: mimeType,
        compressed_bytes: entry.compressedBytes, uncompressed_bytes: entry.uncompressedBytes,
        compression_method: entry.compressionMethod, crc32: entry.crc32, sha256: entry.sha256,
        child_document_id: documentId, child_version_id: versionId,
        status: "queued", error_message: null, updated_at: new Date().toISOString()
      }, { onConflict: "package_id,entry_path" });
      accepted += 1;
      queuedVersionIds.push(versionId);
      manifest.push({ path: entry.path, status: "queued", documentId, childVersionId: versionId, category, sha256: entry.sha256, malwareScan });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nie udało się zapisać pliku z paczki.";
      if (databaseCommitted) {
        accepted += 1;
        queuedVersionIds.push(versionId);
        warnings.push(`${entry.path}: dokument zapisany, ale metadane paczki wymagają naprawy: ${message}`);
        await db.from("document_package_items").upsert({
          package_id: packageRow.id, workspace_id: input.workspaceId, project_id: input.parent.project_id,
          entry_path: entry.path, safe_file_name: sanitizeFileName(entry.fileName), mime_type: mimeType,
          compressed_bytes: entry.compressedBytes, uncompressed_bytes: entry.uncompressedBytes,
          compression_method: entry.compressionMethod, crc32: entry.crc32, sha256: entry.sha256,
          child_document_id: documentId, child_version_id: versionId,
          status: "queued", error_message: `Ostrzeżenie metadanych: ${message}`, updated_at: new Date().toISOString()
        }, { onConflict: "package_id,entry_path" });
        manifest.push({ path: entry.path, status: "queued", warning: message, documentId, childVersionId: versionId, sha256: entry.sha256, malwareScan });
        continue;
      }
      await r2.send(new DeleteObjectCommand({ Bucket: r2Config.bucketName, Key: objectKey })).catch(() => undefined);
      rejected += 1;
      warnings.push(`${entry.path}: ${message}`);
      await db.from("document_package_items").upsert({
        package_id: packageRow.id, workspace_id: input.workspaceId, project_id: input.parent.project_id,
        entry_path: entry.path, safe_file_name: sanitizeFileName(entry.fileName), mime_type: mimeType,
        compressed_bytes: entry.compressedBytes, uncompressed_bytes: entry.uncompressedBytes,
        compression_method: entry.compressionMethod, crc32: entry.crc32, sha256: entry.sha256,
        status: "error", error_message: message, updated_at: new Date().toISOString()
      }, { onConflict: "package_id,entry_path" });
      manifest.push({ path: entry.path, status: "error", error: message, sha256: entry.sha256 });
    }
  }

  if (accepted === 0) {
    await db.from("document_packages").update({
      status: "error", accepted_count: 0, rejected_count: rejected,
      manifest, error_message: "Paczka nie zawiera żadnego obsługiwanego dokumentu.", updated_at: new Date().toISOString()
    }).eq("id", packageRow.id);
    throw new Error("Paczka nie zawiera żadnego obsługiwanego dokumentu.");
  }
  const summary = `Paczka ${input.parent.file_name}: przyjęto ${accepted} plików, odrzucono ${rejected}.`;
  const analysis = packageAnalysis(packageRow.id, accepted, rejected, queuedVersionIds, warnings, input.parent.project_id);
  const now = new Date().toISOString();
  await db.from("document_packages").update({
    status: "expanded", accepted_count: accepted, rejected_count: rejected,
    manifest, expanded_at: now, updated_at: now, error_message: null
  }).eq("id", packageRow.id);
  await db.from("document_classifications").delete().eq("document_version_id", input.parent.id).eq("status", "proposed");
  await db.from("document_classifications").insert({
    workspace_id: input.workspaceId, document_id: input.parent.document_id, document_version_id: input.parent.id,
    category: "other", subcategory: "document_package", proposed_project_id: input.parent.project_id,
    confidence: 1, rationale: summary, schema_version: "document-package-v1", model_name: "secure-zip", status: "approved",
    approved_by: input.userId ?? null, approved_at: now
  });
  await db.from("document_extractions").upsert({
    workspace_id: input.workspaceId, project_id: input.parent.project_id, document_id: input.parent.document_id,
    document_version_id: input.parent.id, extraction_type: "package_manifest", schema_version: "document-package-v1",
    payload: { ...analysis, manifest, security: archive.security }, warnings, confidence: 1, status: "approved"
  }, { onConflict: "document_version_id,extraction_type,schema_version" });
  await db.from("document_texts").upsert({
    workspace_id: input.workspaceId, project_id: input.parent.project_id, document_id: input.parent.document_id,
    document_version_id: input.parent.id, extracted_text: [summary, ...archive.entries.map((entry) => entry.path)].join("\n"),
    extraction_method: "secure_zip_manifest", character_count: summary.length + archive.entries.reduce((sum, entry) => sum + entry.path.length + 1, 0),
    quality_score: 1, updated_at: now
  }, { onConflict: "document_version_id" });
  await db.from("document_intakes").update({
    status: "ready", suggested_category: "other", confidence: 1,
    proposed_project_id: input.parent.project_id, decided_by: input.userId ?? null, decided_at: now,
    decision_note: "Manifest paczki zatwierdzony automatycznie; każdy plik ma osobną analizę i decyzję.",
    source_metadata: { packageId: packageRow.id, accepted, rejected }
  }).eq("document_id", input.parent.document_id);
  await db.from("documents").update({
    category: "other", ai_status: "ready", review_status: "approved", ai_confidence: 1,
    approved_by: input.userId ?? null, approved_at: now, updated_at: now
  }).eq("id", input.parent.document_id);
  await db.from("processing_jobs").update({
    status: "succeeded", stage: "complete", model_name: "secure-zip", prompt_version: "document-package-v1",
    finished_at: now, error_code: null, error_message: null
  }).eq("job_key", `document-pipeline:${input.parent.id}`);
  await db.from("audit_events").insert({
    workspace_id: input.workspaceId, project_id: input.parent.project_id, actor_id: input.userId ?? null,
    actor_type: input.userId ? "user" : "system", event_type: "document.package_expanded",
    entity_type: "document_package", entity_id: packageRow.id,
    after_value: { parentDocumentId: input.parent.document_id, parentVersionId: input.parent.id, accepted, rejected, totalUncompressedBytes: archive.totalUncompressedBytes }
  });
  return analysis;
}

function packageAnalysis(id: string, accepted: number, rejected: number, queuedVersionIds: string[], warnings: string[], projectId: string | null): PackageDocumentAnalysis {
  return {
    category: "other",
    subcategory: "document_package",
    confidence: 1,
    summary: `Bezpiecznie rozpakowano paczkę: ${accepted} plików przyjętych, ${rejected} odrzuconych.`,
    projectHint: "",
    installations: [], workStages: [], requiredProtocols: [], requiredApplications: [],
    searchPassages: [], businessDocument: emptyBusinessDocument(), boqItems: [], facts: [], warnings,
    aiCategory: "other", effectiveCategory: "other", categoryLocked: false,
    proposedProjectId: projectId, projectMatch: null,
    package: { id, accepted, rejected, queuedVersionIds }
  };
}
