import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRevisionImpacts } from "../lib/documents/revision-radar";
import { crc32ForBytes, parseSecureZip } from "../lib/documents/secure-zip";
import { scanDocumentBytes } from "../lib/documents/malware-scan";

afterEach(() => {
  delete process.env.OCTOPUS_MALWARE_SCAN_URL;
  delete process.env.OCTOPUS_MALWARE_SCAN_TOKEN;
  delete process.env.OCTOPUS_REQUIRE_MALWARE_SCAN;
  vi.unstubAllGlobals();
});

function storedZip(entries: Array<{ path: string; content: string }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const data = Buffer.from(entry.content, "utf8");
    const crc = crc32ForBytes(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }
  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

describe("secure ZIP intake", () => {
  it("extracts safe stored entries and creates integrity metadata", () => {
    const result = parseSecureZip(storedZip([
      { path: "01-umowa.txt", content: "Umowa SAN/12/2026" },
      { path: "odbior/protokol.txt", content: "Protokół próby" }
    ]));

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.totalUncompressedBytes).toBeGreaterThan(20);
    expect(result.security.nestedArchivesAllowed).toBe(false);
  });

  it("rejects traversal and duplicate paths before extraction", () => {
    expect(() => parseSecureZip(storedZip([{ path: "../sekret.txt", content: "x" }]))).toThrow("wyjścia poza paczkę");
    expect(() => parseSecureZip(storedZip([
      { path: "Dokument.txt", content: "a" },
      { path: "dokument.txt", content: "b" }
    ]))).toThrow("zduplikowana ścieżka");
  });

  it("rejects content whose CRC differs from the signed manifest", () => {
    const archive = storedZip([{ path: "dokument.txt", content: "abc" }]);
    archive[30 + Buffer.byteLength("dokument.txt")] ^= 0xff;
    expect(() => parseSecureZip(archive)).toThrow("suma CRC");
  });
});

describe("revision radar", () => {
  it("detects scope, financial, schedule and BOQ impacts", () => {
    const impacts = buildRevisionImpacts({
      workStages: ["Montaż"],
      businessDocument: { grossAmount: 10_000, dueDate: "2026-08-10" },
      boqItems: [{ totalPrice: 10_000 }]
    }, {
      workStages: ["Montaż", "Rozruch"],
      businessDocument: { grossAmount: 25_000, dueDate: "2026-08-31" },
      boqItems: [{ totalPrice: 15_000 }, { totalPrice: 10_000 }]
    });

    expect(impacts.map((impact) => impact.target_type)).toEqual(expect.arrayContaining(["wbs", "finance", "schedule", "boq"]));
    expect(impacts.find((impact) => impact.target_type === "finance")?.financial_impact).toBe(15_000);
    expect(impacts.find((impact) => impact.target_type === "schedule")?.schedule_impact_days).toBe(21);
    expect(impacts.find((impact) => impact.target_type === "boq")?.risk_level).toBe("critical");
  });
});

describe("malware quarantine adapter", () => {
  const input = { bytes: Buffer.from("safe"), fileName: "protokol.txt", mimeType: "text/plain", sha256: "a".repeat(64) };

  it("records an optional scanner as unavailable without pretending the file is clean", async () => {
    await expect(scanDocumentBytes(input)).resolves.toMatchObject({ status: "unavailable", required: false });
  });

  it("fails closed when company policy requires a scanner", async () => {
    process.env.OCTOPUS_REQUIRE_MALWARE_SCAN = "true";
    await expect(scanDocumentBytes(input)).rejects.toThrow("MALWARE_SCAN_REQUIRED");
  });

  it("accepts the provider contract and returns an infected verdict", async () => {
    process.env.OCTOPUS_MALWARE_SCAN_URL = "https://scanner.example/scan";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ clean: false, threat: "EICAR", engine: "test", scanId: "scan-1" }), { status: 200 })));

    await expect(scanDocumentBytes(input)).resolves.toMatchObject({ status: "infected", threat: "EICAR", scanId: "scan-1" });
  });
});

describe("document operations contracts", () => {
  const operationsMigration = readFileSync("supabase/migrations/20260822100000_document_operations_suite.sql", "utf8");
  const governanceMigration = readFileSync("supabase/migrations/20260822103000_document_approval_governance.sql", "utf8");
  const quarantineMigration = readFileSync("supabase/migrations/20260822113000_document_malware_quarantine.sql", "utf8");
  const transactionHardeningMigration = readFileSync("supabase/migrations/20260822115000_document_flow_transaction_hardening.sql", "utf8");
  const documentationPage = readFileSync("app/workspace/projects/[projectId]/documentation/page.tsx", "utf8");
  const integrationRoute = readFileSync("app/api/integrations/document-inbox/route.ts", "utf8");

  it("persists channel idempotency, SLA, aliases, matrix and four-way matching", () => {
    expect(operationsMigration).toContain("document_intakes_channel_external_uidx");
    expect(operationsMigration).toContain("escalate_due_document_reviews_atomic");
    expect(operationsMigration).toContain("project_match_feedback");
    expect(operationsMigration).toContain("get_project_document_completeness");
    expect(operationsMigration).toContain("boq_item_id");
    expect(operationsMigration).toContain("budget_price_variance_percent");
    expect(operationsMigration).toContain("matched_dimensions");
  });

  it("keeps approvals, signatures, legal hold and data-room access auditable", () => {
    expect(governanceMigration).toContain("approval_workflow_steps");
    expect(governanceMigration).toContain("content_sha256");
    expect(governanceMigration).toContain("Document is protected by legal hold");
    expect(governanceMigration).toContain("data_room_access_logs");
    expect(governanceMigration).toContain("record_data_room_access_atomic");
  });

  it("blocks unsafe versions from downloads and formal data rooms", () => {
    expect(quarantineMigration).toContain("malware_scan_status");
    expect(quarantineMigration).toContain("guard_data_room_scanned_document");
    expect(readFileSync("app/api/storage/download-url/route.ts", "utf8")).toContain("Dokument jest w kwarantannie");
  });

  it("exposes the operations center in Investments and a signed multichannel intake", () => {
    expect(documentationPage).toContain("ProjectDocumentControl");
    expect(documentationPage).toContain("getProjectDocumentOperations");
    expect(integrationRoute).toContain("sourceExternalKey");
    expect(integrationRoute).toContain("document_ingestion_channels");
  });

  it("keeps triage, integration idempotency and data-room transitions atomic", () => {
    expect(transactionHardeningMigration).toContain("triage_document_intake_atomic");
    expect(transactionHardeningMigration).toContain("complete_integrated_document_upload_v3");
    expect(transactionHardeningMigration).toContain("pg_advisory_xact_lock");
    expect(transactionHardeningMigration).toContain("update_data_room_status_atomic");
    expect(readFileSync("app/api/integrations/document-inbox/complete/route.ts", "utf8")).toContain("complete_integrated_document_upload_v3");
    expect(readFileSync("app/api/documents/governance/route.ts", "utf8")).toContain("update_data_room_status_atomic");
  });

  it("does not accept an unverified external signature or expose a draft room to read-only users", () => {
    expect(readFileSync("app/api/approvals/route.ts", "utf8")).toContain("zweryfikowany callback");
    expect(readFileSync("app/api/data-rooms/[roomId]/manifest/route.ts", "utf8")).toContain("room.status !== \"published\"");
    expect(readFileSync("app/api/data-rooms/[roomId]/documents/[documentId]/route.ts", "utf8")).toContain("level: \"approve\"");
  });
});
